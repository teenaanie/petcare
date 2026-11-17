# Where the Android build gets its Java and its SDK.
#
# Sourced by the npm android scripts. Not optional, and not a preference:
# Android Studio 2026.2 bundles JDK 25, and Gradle 8.14.3 -- the version
# Capacitor 8 pins -- refuses it with
#
#   Unsupported class file major version 69
#
# 69 is JDK 25. Gradle 8.14 reads up to 68. So the build needs a JDK it
# supports, and 21 is the long-term release AGP 8.x is built against.
#
# Installed with: brew install openjdk@21

JDK21_BREW="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
JDK21_SYS="/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home"

if [ -x "$JDK21_BREW/bin/java" ]; then
  export JAVA_HOME="$JDK21_BREW"
elif [ -x "$JDK21_SYS/bin/java" ]; then
  export JAVA_HOME="$JDK21_SYS"
else
  echo "No JDK 21 found. Install one:  brew install openjdk@21" >&2
  echo "(Android Studio's bundled JDK 25 is too new for Gradle 8.14.)" >&2
  exit 1
fi

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

if [ ! -d "$ANDROID_HOME" ]; then
  echo "Android SDK not found at $ANDROID_HOME — open Android Studio once to install it." >&2
  exit 1
fi
