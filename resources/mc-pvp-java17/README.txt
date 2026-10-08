Lunar Revamped PVP Java kit (Windows).
Packaged with the launcher via electron-builder extraResources.

On first launch the launcher copies these files into:
  %APPDATA%\.lunar-revamped\runtimes\mc-pvp-java17\
and downloads GraalVM CE 21 into:
  %APPDATA%\.lunar-revamped\runtimes\graalvm-ce-21\

graalvm.path is rewritten to the downloaded Graal home at install time.

pvp-client.args is a short-pause G1 + safepoint profile for even 1.8.9 frame times
(timer-agent.dll still sets Windows to 1ms scheduling). Do not add JVMCI force flags.
