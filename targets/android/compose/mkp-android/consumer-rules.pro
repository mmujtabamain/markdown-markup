# The UniFFI bindings are reached through JNA: keep them, and JNA, whole.
-keep class mkp.android.ffi.** { *; }
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-dontwarn java.awt.**
