// 2026-08-26 안드로이드 포팅 — iOS PomodoroCage(com.rogan.pomodorocage)의 최소 컴패니언.
// 서버(/state 폴링) 상태 미러링 + 휴식 오버레이 + 오늘 세션 통계.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Isle 앱과 동일한 key.properties 릴리스 서명 관례 적용 (2026-08-26)
import java.io.FileInputStream
import java.util.Properties

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.rogan.pomodorocage"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rogan.pomodorocage"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = keystoreProperties["storeFile"]?.let { file(it) }
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }
}

dependencies {
}
