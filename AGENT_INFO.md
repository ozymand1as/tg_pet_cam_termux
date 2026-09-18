# Agent info for small agents — key specs from spec.md

## Module contracts (§5)
- src/cli.js: colors, prompt/promptPassword/confirm/choose/withSpinner/log/status/clearStatus/banner/table/die. Prompts→stderr, results→stdout. No ANSI if !TTY or NO_COLOR.
- src/settings.js: loadSettings/saveSettings/clearSettings. Atomic write, chmod 0600, PETCAM_HOME override. Migration v1→v2 no-op.
- src/telegram.js: TelegramClient.getMe/getUpdates/sendPhoto/sendVideo/sendDocument + TelegramError + withRetry({maxRetries,onRetry}). Success {ok:true}, failure {ok:false,error_code,description,parameters.retry_after}.
- src/termux.js: hasBinary('termux-camera-photo'), termuxCameraInfo(), termuxCameraPhoto({cameraId,outPath,timeoutMs}), termuxWakeLock(), termuxWakeUnlock(), termuxIsForeground(), termuxSetupStorage().
- src/camera.js: listCameras(), capturePhoto({cameraId,outPath}), postProcess({path,maxWidth,quality}) — if maxWidth==0 && quality>=0.99 return unchanged; else ffmpegResize then parse dimensions.
- src/video.js: recordVideo({mode,durationSec,includeAudio,facing,burstFps,onProgress}), extensionForMime(mime). Intent: ensure ~/storage/shared/Pictures/petcam/, build file:// URI, amStartVideoCapture, poll 500ms until file stable or timeout. Burst: n=clamp(round(d*b),2,600), capture frames, ffmpegEncodeBurst.
- src/scheduler.js: AutoUploadScheduler({onDue}). start(intervalSec), stop(), setInterval(), isRunning(), secondsUntilNext(). Internal tick 1s, nextAt set before await onDue, busy flag, tick never throws.
- src/wakelock.js: WakeLockKeeper({onChange}). enable(): check PATH for termux-wake-lock → onChange('unsupported')/false; call termuxWakeLock() → active/true; non-zero with "permission"/"denied" → denied/false; else off/false + warn. disable(): termuxWakeUnlock(), onChange('off'). Never throws. SIGINT/SIGTERM disable in app.js.
- src/app.js: subcommand dispatch, isSending mutex, lastRecording, TelegramError mapping, renderCaption(template,now), wake-lock policy (§7.11), SIGINT/SIGTERM graceful exit.

## Critical rules
- No absolute paths in source (grep -rn 'from "/\|require("/' . must be empty).
- No console.log in src/ (cli.log only; console.error only when PETCAM_DEBUG=1).
- No npm install needed (dependencies: {}); "type": "module".
- Installer uses bash 4+, $PREFIX/bin/petcam wrapper (NOT symlink to .js), no nested curl|bash, exactly 2 remote fetches (repo clone/archive + nothing else), stdin reattach with exec </dev/tty.
- Settings mode 0600; token redacted in config show; reveal with --reveal.
- Capture permission denied message exact: "Camera permission denied. Grant the Camera permission to Termux:API in Android Settings → Apps."
