import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pasteFieldToWps } from './wps.js';

const execFileAsync = promisify(execFile);
const applications = {
  word: { name: 'Microsoft Word', path: '/Applications/Microsoft Word.app', label: 'Word' },
  wps: { name: 'wpsoffice', path: '/Applications/wpsoffice.app', label: 'WPS' },
};

function rtfEscape(text) {
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const code = text.charCodeAt(index);
    if (character === '\r') continue;
    if (character === '\n') output += '\\line ';
    else if (character === '\t') output += '\\tab ';
    else if (['\\', '{', '}'].includes(character)) output += `\\${character}`;
    else if (code < 128) output += character;
    else output += `\\u${code > 32767 ? code - 65536 : code}?`;
  }
  return output;
}

export function createCitationFieldRtf(text, metadata) {
  const kind = metadata.kind === 'bibliography' ? 'BIBLIOGRAPHY' : 'CITATION';
  const instruction = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64');
  const result = kind === 'BIBLIOGRAPHY'
    ? text.split(/\n{2,}/).map((entry) => `\\pard\\li360\\fi-360\\f0\\fs22 ${rtfEscape(entry)}\\par`).join('')
    : rtfEscape(text);
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}{\\f1 SimSun;}}\\uc1\\pard\\f0\\fs22 {\\field{\\*\\fldinst ADDIN LITDESK_${kind} ${instruction}}{\\*\\fldrslt ${result}}}}`;
}

function writeClipboard(text, rtf) {
  return new Promise((resolve, reject) => {
    const child = spawn('pbcopy', rtf ? ['-Prefer', 'rtf'] : [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error('无法写入系统剪贴板')));
    child.stdin.end(rtf || text);
  });
}

export function integrationStatus() {
  return Object.fromEntries(Object.entries(applications).map(([key, app]) => [key, {
    label: app.label,
    installed: existsSync(app.path) || existsSync(`${process.env.HOME}/Applications/${app.name}.app`),
    mode: 'field',
  }]));
}

export async function chooseFolder(defaultPath) {
  if (process.platform !== 'darwin') throw new Error('当前系统请使用路径输入选择文件夹');
  if (defaultPath && (!String(defaultPath).startsWith('/') || !existsSync(defaultPath))) throw new Error('默认目录不存在');
  const script = `on run argv
    POSIX path of (choose folder with prompt "选择要同步的文献文件夹" default location (POSIX file (item 1 of argv)))
  end run`;
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script, String(defaultPath || process.env.HOME)], { timeout: 300000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const detail = String(error.stderr || error.message);
    if (/User canceled|用户.*取消|\(-128\)/i.test(detail)) return null;
    throw new Error(`文件夹选择未完成：${detail.slice(0, 240)}。也可以改为输入绝对路径`);
  }
}

export async function pasteToApplication(text, target, metadata = {}) {
  const app = applications[target];
  if (!app) throw new Error('不支持的目标应用');
  if (!integrationStatus()[target].installed) throw new Error(`未检测到 ${app.label}`);
  if (process.platform !== 'darwin') throw new Error('一键插入目前支持 macOS，其他系统请使用复制引用');
  if (target === 'wps') return pasteFieldToWps(text, metadata);
  await writeClipboard(text, createCitationFieldRtf(text, metadata));
  const script = `
    tell application "${app.name}" to activate
    delay 0.8
    tell application "System Events" to set frontBundle to bundle identifier of first process whose frontmost is true
    if "${target}" is "wps" then
      if frontBundle is not in {"com.kingsoft.wpsoffice.mac", "com.kingsoft.wpsoffice.mac.global"} then error "目标应用未处于前台，已取消自动粘贴" number 1001
    else
      if frontBundle is not "com.microsoft.Word" then error "目标应用未处于前台，已取消自动粘贴" number 1001
    end if
    tell application "System Events" to keystroke "v" using command down
  `;
  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 12000 });
    return { success: true, message: `已以域格式粘贴到 ${app.label}；点击引用可查看浅灰底纹` };
  } catch (error) {
    const detail = String(error.stderr || error.message);
    if (/not allowed|assistive|automation|1743|1719|1002/i.test(detail)) {
      throw new Error('引用已复制。请在“系统设置 → 隐私与安全性 → 辅助功能/自动化”中允许终端或 LitDesk 控制应用，然后重试；也可直接在文档中按 ⌘V');
    }
    throw new Error(`引用已复制，但自动粘贴失败。请切换到 ${app.label} 后按 ⌘V（${detail.slice(0, 180)}）`);
  }
}

export async function revealFile(filePath) {
  if (process.platform === 'darwin') await execFileAsync('open', ['-R', filePath]);
  else await execFileAsync('xdg-open', [filePath]);
}
