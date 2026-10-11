@echo off
rem Daily IndexNow ping for ktrend.kr and aiwave.kr (Naver, Bing).
rem Cloud routines cannot reach the sites, so this runs on the owner's PC.
rem Run by Windows Task Scheduler task "KTrend IndexNow" (daily 09:00).
rem Log: C:\Users\kkuin\Claude\Ktrend\logs\daily-index.log
setlocal
set "KT=C:\Users\kkuin\Claude\Ktrend"
set "AW=C:\Users\kkuin\Claude\Ai_Wave"
set "NODE=C:\Program Files\nodejs\node.exe"
set "GIT=C:\Program Files\Git\cmd\git.exe"
if not exist "%KT%\logs" mkdir "%KT%\logs"
set "LOG=%KT%\logs\daily-index.log"
echo.>> "%LOG%"
echo [%date% %time%] start>> "%LOG%"

echo -- ktrend.kr>> "%LOG%"
cd /d "%KT%" || (echo cd failed>> "%LOG%" & goto aiwave)
"%GIT%" pull --ff-only -q >> "%LOG%" 2>&1
"%NODE%" scripts\indexnow.mjs --live --since 3 >> "%LOG%" 2>&1

:aiwave
echo -- aiwave.kr>> "%LOG%"
cd /d "%AW%" || (echo cd failed>> "%LOG%" & goto end)
"%GIT%" pull --ff-only -q >> "%LOG%" 2>&1
"%NODE%" scripts\ping-search-engines.mjs --since 3 >> "%LOG%" 2>&1

:end
echo [%date% %time%] end>> "%LOG%"
endlocal
exit /b 0
