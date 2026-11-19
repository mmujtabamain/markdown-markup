# The UniFFI bindings are reached through JNA: keep them, and JNA, whole.
-keep class xtmd.android.ffi.** { *; }
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-dontwarn java.awt.**
