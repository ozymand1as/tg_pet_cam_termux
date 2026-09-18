export async function recordVideo({mode,durationSec}){ return {path:'/tmp/v.mp4',mimeType:'video/mp4',width:640,height:480,durationSec,bytes:0}; }
export function extensionForMime(m){ return m.includes('webm')?'webm':'mp4'; }
