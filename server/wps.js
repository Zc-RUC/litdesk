import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rmSync } from 'node:fs';
import { createCitationDocx } from './citation-docx.js';

const execFileAsync = promisify(execFile);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function osascript(script) {
  return execFileAsync('osascript', ['-e', script], { timeout: 18000, maxBuffer: 1024 * 1024 });
}

async function activeWindow() {
  await osascript('tell application "System Events" to tell process "wpsoffice" to set frontmost to true');
  const { stdout } = await osascript(`tell application "System Events"
    if frontmost of process "wpsoffice" is false then error "WPS 未处于前台"
    get name of front window of process "wpsoffice"
  end tell`);
  return stdout.trim();
}

async function activateDocument(name) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await activeWindow() === name) return;
    await osascript('tell application "System Events" to keystroke tab using control down');
    await sleep(350);
  }
  throw new Error(`未找到目标文档“${name}”，已取消插入`);
}

async function currentWindow() {
  await osascript('tell application "wpsoffice" to activate');
  await sleep(800);
  const name = await activeWindow();
  if (!name) throw new Error('请先在 WPS 中打开目标文档并放好光标');
  if (/^litdesk-citation-[\w-]+\.docx$/.test(name)) throw new Error('当前是临时引用文档，请先切换回目标文档');
  return name;
}

export async function pasteFieldToWps(text, metadata) {
  const source = createCitationDocx(text, metadata);
  try {
    const targetWindow = await currentWindow();
    await execFileAsync('open', ['-a', 'wpsoffice', source.filePath]);
    await sleep(1800);
    await activateDocument(source.sourceName);
    await osascript(`tell application "System Events"
      keystroke "a" using command down
      keystroke "c" using command down
    end tell`);
    await activateDocument(source.sourceName);
    await osascript('tell application "System Events" to keystroke "w" using command down');
    await activateDocument(targetWindow);
    await osascript('tell application "System Events" to keystroke "v" using command down');
    return { success: true, message: '已以域格式粘贴到 WPS；点击引用可查看浅灰底纹' };
  } catch (error) {
    const detail = String(error.stderr || error.message).slice(0, 300);
    throw new Error(`WPS 域插入未完成。请确认目标文档已打开且光标位于正文：${detail}`);
  } finally {
    rmSync(source.directory, { recursive: true, force: true });
  }
}
