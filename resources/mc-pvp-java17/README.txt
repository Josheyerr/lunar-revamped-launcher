Lunar Revamped PVP Java kit (Windows).
Packaged with the launcher via electron-builder extraResources.

On first launch the launcher copies these files into:
  %APPDATA%\.lunar-revamped\runtimes\mc-pvp-java17\
and downloads GraalVM CE 21 into:
  %APPDATA%\.lunar-revamped\runtimes\graalvm-ce-21\

graalvm.path is rewritten to the downloaded Graal home at install time.
