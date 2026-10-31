@echo off
setlocal
cd /d "D:\DSHWS"
start "" /b node "D:\DSHWS\dsh-plugin-model-matrix\scripts\self-healer.mjs"
start "" "C:\Users\liuyang40\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" %*
endlocal
