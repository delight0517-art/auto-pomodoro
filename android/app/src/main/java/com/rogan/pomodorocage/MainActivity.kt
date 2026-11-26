package com.rogan.pomodorocage

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * 2026-08-26 안드로이드 포팅 — iOS PomodoroCage의 최소 컴패니언.
 * Mac 서버(pomodoro-api.js, :8787)의 /state를 폴링해 타이머 상태를 미러링하고,
 * break 구간엔 전체 화면 휴식 오버레이를 띄운다. iOS의 ScreenTime 차단은
 * Android에서 별도 권한(UsageStats)이라 이 버전에선 미포함(추후 과제).
 */
class MainActivity : Activity() {

    private lateinit var phaseLabel: TextView
    private lateinit var timeLabel: TextView
    private lateinit var cycleLabel: TextView
    private lateinit var serverLabel: TextView
    private lateinit var todayLabel: TextView
    private lateinit var overlay: LinearLayout

    private val executor = Executors.newSingleThreadExecutor()
    @Volatile private var running = true
    @Volatile private var lastPhase: String? = null

    private var serverBase: String = "http://127.0.0.1:8787"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("pomodorocage", MODE_PRIVATE)
        serverBase = prefs.getString("serverBase", null) ?: detectServerBase()

        buildUi()
        executor.execute { pollLoop() }
    }

    /** iOS PomodoroWiFiDiscovery와 동일한 /24 스캔 + /health 프로브.
     *  루프백(adb reverse/에뮬레이터·본기 서버)을 맨 먼저 확인해 스캔 지연을 피한다. */
    private fun detectServerBase(): String {
        if (probeHealth("http://127.0.0.1:8787")) return "http://127.0.0.1:8787"
        return try {
            val ip = localIPv4() ?: return "http://127.0.0.1:8787"
            val prefix = ip.substringBeforeLast('.')
            for (host in 1..254) {
                val candidate = "http://$prefix.$host:8787"
                if (probeHealth(candidate)) return candidate
            }
            "http://127.0.0.1:8787"
        } catch (e: Exception) {
            "http://127.0.0.1:8787"
        }
    }

    private fun localIPv4(): String? {
        val en = NetworkInterface.getNetworkInterfaces() ?: return null
        for (ni in en) {
            for (addr in ni.inetAddresses) {
                if (!addr.isLoopbackAddress && addr is Inet4Address) return addr.hostAddress
            }
        }
        return null
    }

    private fun probeHealth(base: String): Boolean = try {
        val conn = URL("$base/health").openConnection() as HttpURLConnection
        conn.connectTimeout = 400
        conn.readTimeout = 400
        val code = conn.responseCode
        if (code == 401) true else code == 200   // 토큰 걸린 서버도 "발견됨"으로 간주(상세 상태는 /state에서 판정)
    } catch (e: Exception) {
        false
    }

    @SuppressLint("SetTextI18n")
    private fun buildUi() {
        val pad = (16 * resources.displayMetrics.density).toInt()
        overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setBackgroundColor(Color.parseColor("#101418"))
            setPadding(pad, pad, pad, pad)
        }
        phaseLabel = TextView(this).apply {
            textSize = 20f
            setTextColor(Color.WHITE)
        }
        timeLabel = TextView(this).apply {
            textSize = 56f
            setTextColor(Color.parseColor("#7ED9A7"))
        }
        cycleLabel = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.parseColor("#9AA5B1"))
        }
        todayLabel = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.parseColor("#9AA5B1"))
        }
        serverLabel = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.parseColor("#5C6773"))
        }
        overlay.addView(phaseLabel)
        overlay.addView(timeLabel)
        overlay.addView(cycleLabel)
        overlay.addView(todayLabel)
        overlay.addView(serverLabel)
        setContentView(overlay)
    }

    private fun pollLoop() {
        while (running) {
            val state = try {
                fetchState()
            } catch (e: Exception) {
                null
            }
            val ui = state ?: JSONObject().put("phase", "offline")
            runOnUiThread { render(ui) }
            try {
                Thread.sleep(3000)
            } catch (e: InterruptedException) {
                return
            }
        }
    }

    private fun fetchState(): JSONObject? {
        val conn = URL("$serverBase/state").openConnection() as HttpURLConnection
        conn.connectTimeout = 1500
        conn.readTimeout = 1500
        // 서버(launchd com.rogan.pomodoro-sync-server)의 POMODORO_TOKEN 과 동일 값 —
        // iOS 클라이언트의 x-pomodoro-token 헤더와 같은 계약 (pomodoro-api.js:580).
        // 본인 LAN 서버 전용 컴패니언이라 launchd에 등록된 고정 토큰을 기본값으로 사용한다.
        val token = getSharedPreferences("pomodorocage", MODE_PRIVATE)
            .getString("apiToken", "<POMODORO_SYNC_TOKEN>")
        conn.setRequestProperty("x-pomodoro-token", token)
        if (conn.responseCode != 200) return null
        val body = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
        return JSONObject(body)
    }

    @SuppressLint("SetTextI18n")
    private fun render(state: JSONObject) {
        val phase = state.optString("phase", "")
        when {
            phase == "offline" -> {
                phaseLabel.text = "서버에 연결 안 됨"
                timeLabel.text = "--:--"
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            else -> {
                val remainingMs = state.optLong("remainingMs", state.optLong("remaining_ms", 0L))
                val total = (remainingMs / 1000L).coerceAtLeast(0L)
                val mm = total / 60
                val ss = total % 60
                val isBreak = phase.contains("break", ignoreCase = true)
                phaseLabel.text = if (isBreak) "휴식 중" else "집중 중"
                timeLabel.text = String.format(Locale.US, "%02d:%02d", mm, ss)
                timeLabel.setTextColor(if (isBreak) Color.parseColor("#6FB7FF") else Color.parseColor("#7ED9A7"))
                cycleLabel.text = "${state.optInt("completedFocusCount", state.optInt("cycle", 0))} 라운드 완료"
                todayLabel.text = "오늘 집중 ${todayFocusMinutes()}분"
                serverLabel.text = serverBase
                if (isBreak) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    // 휴식 오버레이(iOS BreakOverlayView 대응): 화면을 밝게 유지하고 방해 금지
                    overlay.setBackgroundColor(Color.parseColor("#0E2A46"))
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    overlay.setBackgroundColor(Color.parseColor("#101418"))
                }
            }
        }
        lastPhase = phase
    }

    /** 로컬 세션 기록(간단 버전): iOS PomodoroSessionStore의 "오늘 집중 분"만 재현 */
    private fun todayFocusMinutes(): Long {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val key = "focusMin.${sdf.format(Date())}"
        val prefs = getSharedPreferences("pomodorocage_sessions", MODE_PRIVATE)
        return prefs.getLong(key, 0L)
    }

    override fun onDestroy() {
        running = false
        executor.shutdownNow()
        super.onDestroy()
    }
}
