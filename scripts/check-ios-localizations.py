#!/usr/bin/env python3
"""Fail a build when iOS strings are missing, malformed, or format-incompatible."""

from collections import Counter
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "ios/PomodoroCage/Resources/Localizable.xcstrings"
SOURCES = ROOT / "ios/PomodoroCage/Sources"
BAD_TEXT = ("Ã", "Â", "Ð", "Ñ", "â€", "ï¿½", "\ufffd")
FORMAT = re.compile(r"%(?:\d+\$)?[-+#0 ]*\d*(?:\.\d+)?(?:@|[diuoxXfFeEgGcs])")
HANGUL = re.compile(r"[\uac00-\ud7af]")
REQUIRED_LANGUAGES = {"en", "ja", "ko", "zh-Hans"}
# These entries are intentionally language-neutral: formatting scaffolding or product names.
LOCALE_INVARIANT_KEYS = {
    "settings.schedule.labelSuffix",
    "settings.schedule.noLockSummary",
    "settings.schedule.lockSummary",
    "stats.mac.agentStatus",
    "stats.mac.navigationTitle",
}
LOCALIZED_CALL = re.compile(r"\bL(?:F)?\(\s*\"([^\"]+)\"")
UI_LITERAL = re.compile(
    r"\b(?:Text|Label|Section|Button|Picker|DatePicker|Toggle|LabeledContent|TextField|SecureField|Menu|Link|Alert)"
    r"\s*\(\s*(?:verbatim\s*:\s*)?\"([^\"]*)\""
    r"|\b(?:navigationTitle|accessibilityLabel|accessibilityHint|help|prompt|alert|confirmationDialog)"
    r"\s*\(\s*\"([^\"]*)\""
)
UI_LITERAL_ALLOWLIST = {"Mac", "Auto Pomodoro"}


def string_units(value):
    if isinstance(value, dict):
        if isinstance(value.get("stringUnit"), dict):
            unit = value["stringUnit"]
            if isinstance(unit.get("value"), str):
                yield unit["value"]
        for key, nested in value.items():
            if key != "stringUnit":
                yield from string_units(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from string_units(nested)


def fail(message):
    print(f"iOS localization check: {message}", file=sys.stderr)
    return 1


def main():
    try:
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    except Exception as error:
        return fail(f"cannot parse {CATALOG.relative_to(ROOT)}: {error}")

    strings = catalog.get("strings", {})
    source_language = catalog.get("sourceLanguage")
    if not strings or not source_language:
        return fail("catalog has no strings or sourceLanguage")

    languages = sorted({
        language
        for item in strings.values()
        for language in item.get("localizations", {})
    })
    errors = []
    if set(languages) != REQUIRED_LANGUAGES:
        errors.append(
            "catalog languages must exactly match the supported set "
            f"{sorted(REQUIRED_LANGUAGES)}; found {languages}"
        )

    for key, item in strings.items():
        translations = item.get("localizations", {})
        source_values = list(string_units(translations.get(source_language, {})))
        if not source_values:
            errors.append(f"{key}: missing source-language value ({source_language})")
            continue
        source_formats = {tuple(sorted(Counter(FORMAT.findall(value)).items())) for value in source_values}
        if len(source_formats) != 1:
            errors.append(f"{key} ({source_language}): format placeholders differ between variants")
        expected_formats = Counter(dict(next(iter(source_formats), ())))

        for language in languages:
            values = list(string_units(translations.get(language, {})))
            if not values:
                errors.append(f"{key}: missing {language} translation")
                continue
            if language != source_language:
                for value in values:
                    if value in source_values and key not in LOCALE_INVARIANT_KEYS:
                        errors.append(f"{key} ({language}): untranslated source-language value")
                    if HANGUL.search(value):
                        errors.append(f"{key} ({language}): Korean text leaked into a non-Korean translation")
            for value in values:
                if any(marker in value for marker in BAD_TEXT):
                    errors.append(f"{key} ({language}): suspicious mojibake/replacement character")
                if Counter(FORMAT.findall(value)) != expected_formats:
                    errors.append(f"{key} ({language}): format placeholders differ from {source_language}")

    referenced = set()
    for path in SOURCES.rglob("*.swift"):
        text = path.read_text(encoding="utf-8")
        referenced.update(LOCALIZED_CALL.findall(text))
        for match in UI_LITERAL.finditer(text):
            literal = match.group(1) if match.group(1) is not None else match.group(2)
            visible_prefix = literal.split("\\(", 1)[0].strip()
            if visible_prefix and re.search(r"[A-Za-z\uac00-\ud7a3]", visible_prefix) and visible_prefix not in UI_LITERAL_ALLOWLIST:
                line_number = text.count("\n", 0, match.start()) + 1
                errors.append(
                    f"{path.relative_to(ROOT)}:{line_number}: raw UI text must use L/LF: {visible_prefix}"
                )
    for key in sorted(referenced - strings.keys()):
        errors.append(f"Swift localization key is missing from catalog: {key}")

    if errors:
        print("iOS localization check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"iOS localization check passed: {len(strings)} keys, {len(languages)} languages, {len(referenced)} Swift references")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
