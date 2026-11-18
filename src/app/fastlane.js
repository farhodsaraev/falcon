// Falcon's fast lane: a handful of very common, harmless requests ("next slide", "open Excel",
// "louder") are carried out straight away with his own small programs, in about a second, instead of
// going the long way round through the AI (8 to 16 seconds). Anything it does not recognise for
// certain, and anything that fails in a way it cannot explain, goes to the AI exactly as before.
// Windows only for now.
import { spawn } from 'node:child_process';
import path from 'node:path';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  'первый': 1, 'второй': 2, 'третий': 3, 'четвертый': 4, 'четвёртый': 4, 'пятый': 5 };
function slideNumber(word) {
  const w = String(word || '').replace(/^number /, '').replace(/^№\s*/, '');
  if (/^\d{1,3}$/.test(w)) return Number(w);
  if (NUMBER_WORDS.includes(w)) return NUMBER_WORDS.indexOf(w);
  return ORDINALS[w] || 0;
}

// Words after "open" that are not apps: those go to the AI, which knows about files, sites and mail.
const NOT_AN_APP = /\b(it|that|this|them|these|file|files|folder|document|presentation|deck|slide|slides|site|website|page|link|tab|mail|email|inbox|message|invoice|report|youtube|gmail|google|facebook|instagram|twitter|linkedin|news|weather|video|photo|picture|его|её|это|файл|папку|документ|сайт|страницу|почту|письмо|ссылку)\b/;
// A "find" that needs thinking (dates, people, the web) rather than a file name.
const NOT_A_FILE_NAME = /\b(month|week|year|yesterday|today|tomorrow|about|who|where|how|what|when|why|email|mail|message|web|online|google|internet|flight|hotel|restaurant|price|from|sent|received|everything|out|вчера|сегодня|месяц|недел|письмо|почт|кто|где|как|что|интернет)\b/;

/** What the user wants, if it is one of the fast-lane requests; otherwise null. */
export function matchFast(input) {
  let t = String(input || '').toLowerCase().replace(/[“”"«»]/g, '').replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/, '');
  t = t.replace(/^(?:hey |ok |okay )?(?:falcon|фалкон|фалькон)[,.! ]+/, '').replace(/[,.! ]+(?:falcon|фалкон|фалькон)$/, '');
  t = t.replace(/^(?:please |could you |can you |would you |now |and now |then |пожалуйста,? |а теперь |теперь )+/, '');
  t = t.replace(/[.!?…]+$/, '').replace(/,? (?:please|пожалуйста)$/, '').replace(/,? (?:sir|madam|boss|сэр)$/, '').trim();
  if (!t || t.length > 90) return null;
  let m;

  // ---- Slides ----
  if (/^(?:next(?: slide)?|next one|forward|go forward|(?:go to |show )?(?:the )?next slide|следующий(?: слайд)?|дальше|вперед|вперёд|на следующий слайд)$/.test(t)) return { do: 'step', step: 1 };
  if (/^(?:previous(?: slide)?|back|go back|back one|(?:go to |show )?(?:the )?previous slide|(?:go )?back a slide|предыдущий(?: слайд)?|назад|на предыдущий слайд)$/.test(t)) return { do: 'step', step: -1 };
  if (/^(?:(?:go to |show |jump to )?(?:the )?last slide|последний слайд|на последний слайд)$/.test(t)) return { do: 'last' };
  if ((m = /^(?:go to |show |jump to |open |switch to |move to )?(?:the )?slide (number \d{1,3}|\d{1,3}|[a-z]+)$/.exec(t)) && slideNumber(m[1])) return { do: 'slide', slide: slideNumber(m[1]) };
  if ((m = /^(?:go to |show |jump to )?(?:the )?([a-z]+) slide$/.exec(t)) && ORDINALS[m[1]]) return { do: 'slide', slide: ORDINALS[m[1]] };
  if ((m = /^(?:перейди на |покажи |открой |на )?слайд (?:номер )?(\d{1,3})$/.exec(t))) return { do: 'slide', slide: Number(m[1]) };
  if ((m = /^(?:перейди на |покажи |открой |на )?(\d{1,3})(?:-?й)? слайд$/.exec(t))) return { do: 'slide', slide: Number(m[1]) };

  // ---- A presentation by name, optionally on a slide ----
  m = /^(?:open|show|start) (?:my |the |our )?(.+?) (?:presentation|deck)(?:,? (?:and |then )?(?:go to |on |at |to |jump to )?(?:the )?slide (number \d{1,3}|\d{1,3}|[a-z]+))?$/.exec(t)
    || /^(?:открой|покажи|запусти) презентацию (.+?)(?:,? (?:и перейди )?на (?:слайд|слайде) (?:номер )?(\d{1,3}))?$/.exec(t);
  if (m && !/\b(?:presentation|deck|about|for|from|email|mail)\b/.test(m[1])) {
    const slide = m[2] ? slideNumber(m[2]) : 0;
    if (!m[2] || slide) return { do: 'deck', find: m[1].replace(/'s\b/g, ''), slide };
  }

  // ---- Sound and music ----
  if (/^(?:volume up|louder|turn (?:it|the volume|the sound) up|turn up the (?:volume|sound)|increase the volume|погромче|громче|сделай (?:по)?громче|прибавь (?:звук|громкость))$/.test(t)) return { do: 'keys', keys: 'volumeup', times: 5, say: 'louder' };
  if (/^(?:volume down|quieter|softer|turn (?:it|the volume|the sound) down|turn down the (?:volume|sound)|lower the volume|потише|тише|сделай (?:по)?тише|убавь (?:звук|громкость))$/.test(t)) return { do: 'keys', keys: 'volumedown', times: 5, say: 'quieter' };
  if (/^(?:pause|pause (?:the |my )?(?:music|song|video)|stop (?:the |my )?music|play|resume|play (?:the |my )?music|resume (?:the |my )?music|пауза|поставь на паузу|останови музыку|продолжи|включи музыку)$/.test(t)) return { do: 'keys', keys: 'playpause', times: 1, say: 'playpause' };
  if (/^(?:next (?:song|track)|skip(?: this)?(?: song| track)?|следующ(?:ая|ую) песн[яю]|следующий трек)$/.test(t)) return { do: 'keys', keys: 'nexttrack', times: 1, say: 'next' };
  if (/^(?:previous (?:song|track)|last (?:song|track)|предыдущ(?:ая|ую) песн[яю]|предыдущий трек)$/.test(t)) return { do: 'keys', keys: 'prevtrack', times: 1, say: 'previous' };

  // ---- A plain hello or thank-you: answered at once (the AI took 20 seconds over "Hi!") ----
  if (/^(?:hi|hello|hey|hi there|hello there|hey there|greetings|привет|здравствуй|здравствуйте|добрый день|добрый вечер)$/.test(t)) return { do: 'hello' };
  if (/^(?:thanks|thank you|thanks a lot|thank you very much|many thanks|cheers|спасибо|благодарю|спасибо большое)$/.test(t)) return { do: 'thanks' };

  // ---- The desktop picture ----
  if (/^(?:change|switch|replace|update|set) (?:my |the )?(?:desktop |pc |computer )?(?:wallpaper|background|background image|background picture|desktop image|desktop picture|desktop background)(?: (?:to|for|with) (?:something else|sth else|another one|a new one|something new|a different one|anything))?$/.test(t)
    || /^(?:new|another|next|different) (?:wallpaper|background|desktop picture|desktop image)$/.test(t)
    || /^(?:смени|поменяй|измени|поставь друг(?:ие|ую)) (?:мои |мой |мою )?(?:обои|фон|фон рабочего стола|картинку на рабочем столе|заставку)(?: на (?:что-нибудь другое|другие|другую|другой))?$/.test(t)
    || /^(?:другие|новые|следующие) обои$/.test(t)) return { do: 'wallpaper' };

  // ---- The time and the date ----
  if (/^(?:what(?:'s| is) the time|what time is it|the time|time|который час|сколько (?:сейчас )?времени)$/.test(t)) return { do: 'time' };
  if (/^(?:what(?:'s| is) the date(?: today)?|what(?:'s| is) today'?s date|what day is it(?: today)?|what(?:'s| is) the day today|какое сегодня число|какой сегодня день)$/.test(t)) return { do: 'date' };

  // ---- Apps ----
  if ((m = /^(?:open|launch|start|run|bring up|switch to|открой|запусти|включи) (?:the |my |up )?([\p{L}\p{N}][\p{L}\p{N} +&-]{0,30})(?: app| application| приложение)?$/u.exec(t))
    && m[1].split(' ').length <= 3 && !NOT_AN_APP.test(m[1])) return { do: 'app-open', name: m[1].trim() };
  if ((m = /^(?:close|quit|exit|закрой) (?:the |my )?([\p{L}\p{N}][\p{L}\p{N} +&-]{0,30})(?: app| application| приложение)?$/u.exec(t))
    && m[1].split(' ').length <= 3 && !NOT_AN_APP.test(m[1]) && !/^(?:all|everything|window|falcon|все|всё|окно)$/.test(m[1])) return { do: 'app-close', name: m[1].trim() };

  // ---- A file by name ----
  if ((m = /^(?:find|look for|search for|where is|where's|найди|поищи|где) (?:me )?(.+)$/.exec(t)) && !NOT_A_FILE_NAME.test(m[1])) {
    const query = m[1].replace(/\b(?:my|the|a|an|latest|newest|last|recent|most recent|file|files|document|called|named|мой|мою|мои|последний|последнюю|файл|документ)\b/g, ' ').replace(/'s\b/g, '').replace(/\s+/g, ' ').trim();
    if (query && query.split(' ').length <= 4 && /^[\p{L}\p{N} ._-]+$/u.test(query)) return { do: 'find', query };
  }
  return null;
}

/** Runs one of Falcon's small Windows programs and returns the JSON it printed, or null. */
export function runScript(file, args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args.map(String)], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
      try { resolve(JSON.parse(line)); } catch { resolve(null); }
    });
    child.stdin.end();
  });
}

const RU_ADDRESS = { sir: 'сэр', madam: 'мадам', boss: 'босс' };

/**
 * Carries out a fast-lane request. Returns { reply, actions, note } when it is done (or cannot be done,
 * with a plain reason), or null to hand the request to the AI instead.
 *   note: one line telling the AI later what was done here, so the conversation stays in one piece.
 */
export async function fastLane(text, { packDir, callMe = 'sir', run = runScript, platform = process.platform, now = new Date(), memory = {}, open = () => {} } = {}) {
  if (platform !== 'win32') return null;
  // A file he was just offered: a plain "yes" or "open it" opens it at once. Any other request drops the offer.
  const offered = memory.offer;
  memory.offer = null;
  if (offered) {
    const said = String(text || '').toLowerCase().replace(/[.!?…,]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/ (?:please|falcon|sir|madam|boss|пожалуйста|сэр)$/g, '');
    if (/^(?:yes|yes please|yes open it|yep|yeah|sure|ok|okay|do|please do|go ahead|open|open it|open that|open the file|да|ага|давай|открой|открывай|открой его|да открой)$/.test(said)) {
      const ruSaid = /[а-яё]/i.test(text);
      const who = ruSaid ? (RU_ADDRESS[String(callMe).toLowerCase()] || callMe) : callMe;
      const name = path.win32.basename(offered);
      open(offered);
      return { reply: ruSaid ? `«${name}» открыт, ${who}.` : `${name} is open, ${who}.`, actions: [ruSaid ? `Открыл «${name}»` : `Opened ${name}`],
        note: `"${String(text).trim().slice(0, 60)}": opened the file ${offered} for him` };
    }
  }
  // Right after a new desktop picture, "another" or "next" brings the next one.
  const again = memory.wallpaper;
  memory.wallpaper = false;
  const want = again && /^(?:another|another one|next|next one|one more|again|different|a different one|try another|not this one|ещё|еще|другую|другой|следующую|следующий|ещё одну)[.!]?$/i.test(String(text || '').trim().replace(/,? (?:please|falcon|пожалуйста)[.!]?$/i, ''))
    ? { do: 'wallpaper' } : matchFast(text);
  if (!want) return null;
  const ru = /[а-яё]/i.test(text);
  const you = ru ? (RU_ADDRESS[String(callMe).toLowerCase()] || callMe) : callMe;
  const skill = (...parts) => path.join(packDir, 'skills-windows', ...parts);
  const done = (reply, actions, note) => ({ reply, actions, note: `"${String(text).trim().slice(0, 120)}": ${note}` });

  if (want.do === 'hello') {
    const hour = now.getHours();
    const part = ru ? (hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер')
      : (hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
    return done(ru ? `${part}, ${you}. Чем могу помочь?` : `${part}, ${you}. What can I do for you?`, [], 'greeted him and asked what he needs');
  }
  if (want.do === 'thanks') return done(ru ? `Всегда к вашим услугам, ${you}.` : `My pleasure, ${you}.`, [], 'he thanked you; you acknowledged it');

  if (want.do === 'time' || want.do === 'date') {
    const locale = ru ? 'ru-RU' : 'en-GB';
    if (want.do === 'time') {
      const time = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      return done(ru ? `Сейчас ${time}, ${you}.` : `It is ${time}, ${you}.`, [], `told him the time, ${time}`);
    }
    const date = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return done(ru ? `Сегодня ${date}, ${you}.` : `Today is ${date}, ${you}.`, [], `told him the date, ${date}`);
  }

  if (['step', 'last', 'slide', 'deck'].includes(want.do)) {
    const args = [];
    if (want.do === 'deck') args.push('-Find', want.find);
    if (want.do === 'step') args.push('-Step', want.step);
    if (want.do === 'last') args.push('-Last');
    if (want.slide) args.push('-Slide', want.slide);
    const r = await run(skill('presentations', 'slides.ps1'), args);
    if (!r) return null;
    if (!r.ok) {
      const error = String(r.error || '');
      const only = /only (\d+) slides/.exec(error);
      if (only) return done(ru ? `В презентации только ${only[1]} слайдов, ${you}.` : `The presentation has only ${only[1]} slides, ${you}.`, [], `refused, the presentation has only ${only[1]} slides`);
      if (/already the first/.test(error)) return done(ru ? `Это уже первый слайд, ${you}.` : `This is already the first slide, ${you}.`, [], 'nothing to do, already on the first slide');
      if (/already the last/.test(error)) return done(ru ? `Это уже последний слайд, ${you}.` : `This is already the last slide, ${you}.`, [], 'nothing to do, already on the last slide');
      if (/No presentation is open/.test(error) && want.do !== 'deck') return done(ru ? `Сейчас не открыта ни одна презентация, ${you}. Какую открыть?` : `No presentation is open, ${you}. Which one shall I open?`, [], 'no presentation was open');
      if (/Class not registered|80040154/i.test(error)) return done(ru ? `На этом компьютере не установлен PowerPoint, ${you}.` : `PowerPoint is not installed on this computer, ${you}.`, [], 'could not, PowerPoint is not installed on this computer');
      return null;   // not found, anything else: let the AI work it out
    }
    const name = String(r.name || '').replace(/\.pptx?$/i, '');
    const where = `${r.name} (${r.path}), ${r.total} slides`;
    if (want.do === 'deck' && !want.slide) {
      return done(ru ? `Презентация «${name}» открыта, ${you}.` : `${name} is open, ${you}.`, [ru ? `Открыл «${name}»` : `Opened ${name}`], `opened ${where}`);
    }
    const actions = want.do === 'deck' ? [ru ? `Открыл «${name}»` : `Opened ${name}`, ru ? `Перешёл на слайд ${r.slide}` : `Went to slide ${r.slide}`]
      : [ru ? `Перешёл на слайд ${r.slide}` : `Went to slide ${r.slide}`];
    return done(ru ? `Слайд ${r.slide} из ${r.total} на экране, ${you}.` : `Slide ${r.slide} of ${r.total} is up, ${you}.`, actions, `now showing slide ${r.slide} of ${where}`);
  }

  if (want.do === 'wallpaper') {
    const r = await run(skill('apps', 'apps.ps1'), ['-Do', 'wallpaper']);
    if (!r || !r.ok) return null;
    memory.wallpaper = true;
    return done(ru ? `На рабочем столе новая картинка, ${you}. Скажите «другую», если хотите ещё.` : `Your desktop has a new picture, ${you}. Say "another" if you would like a different one.`,
      [ru ? 'Сменил обои' : 'Changed the desktop picture'], `changed the desktop picture to ${r.picture} (before: ${r.previous || 'unknown'}); ${r.choices} built-in pictures to choose from`);
  }

  if (want.do === 'keys') {
    const r = await run(skill('apps', 'apps.ps1'), ['-Do', 'keys', '-Keys', want.keys, '-Times', want.times]);
    if (!r || !r.ok) return null;
    const said = {
      louder: ['Louder', 'Погромче', 'Turned the volume up', 'Сделал громче'],
      quieter: ['Quieter', 'Потише', 'Turned the volume down', 'Сделал тише'],
      playpause: ['Done', 'Готово', 'Pressed play or pause', 'Нажал паузу'],
      next: ['Next track', 'Следующий трек', 'Skipped to the next track', 'Включил следующий трек'],
      previous: ['Previous track', 'Предыдущий трек', 'Went to the previous track', 'Включил предыдущий трек'],
    }[want.say];
    return done(`${said[ru ? 1 : 0]}, ${you}.`, [said[ru ? 3 : 2]], said[2].toLowerCase());
  }

  if (want.do === 'app-open') {
    const r = await run(skill('apps', 'apps.ps1'), ['-Do', 'open', '-Name', want.name], { timeoutMs: 30000 });
    if (!r || !r.ok) return null;   // not an installed app: perhaps a file or a site, which the AI handles
    // An app that was already running reports its window title, which can be a document's name: say the
    // name the user used instead.
    const app = r.alreadyOpen ? want.name.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : String(r.app).slice(0, 40);
    return done(ru ? `${app} открыт, ${you}.` : `${app} is open, ${you}.`, [ru ? `Открыл ${app}` : `Opened ${app}`], `opened the app ${r.app}${r.alreadyOpen ? ' (it was already running; brought to the front)' : ''}`);
  }

  if (want.do === 'app-close') {
    const r = await run(skill('apps', 'apps.ps1'), ['-Do', 'close', '-Name', want.name]);
    if (!r || !r.ok) return null;
    if (r.closed) return done(ru ? `Закрыл ${r.app}, ${you}.` : `${r.app} is closed, ${you}.`, [ru ? `Закрыл ${r.app}` : `Closed ${r.app}`], `closed the app ${r.app}`);
    if (r.app) return done(ru ? `${r.app} ещё открыт, ${you}: похоже, он спрашивает, сохранить ли изменения.` : `${r.app} is still open, ${you}; it is probably asking whether to save.`, [], `asked ${r.app} to close, but it stayed open, probably asking whether to save`);
    return null;                   // no such window: the AI may know what he meant
  }

  if (want.do === 'find') {
    // A short wait only: when nothing turns up quickly, the slow folder-by-folder search is the AI's job.
    const r = await run(skill('files', 'find-files.ps1'), ['-Query', want.query], { timeoutMs: 4000 });
    const all = r && r.ok && Array.isArray(r.files) ? r.files : [];
    if (!all.length) return null; // nothing by that name: the AI can look further or ask
    // Files Falcon made himself (his documents, dossiers, test files) are not what "my invoice" means:
    // seen live, the spreadsheet he had just made from the invoice came first. Prefer the user's own.
    const own = all.filter((f) => !/\\Falcon (?:Documents|Scout|Test)\\/i.test(String(f.path)));
    const files = own.length ? own : all;
    memory.offer = files[0].path;
    const name = path.win32.basename(files[0].path);
    const folder = path.win32.basename(path.win32.dirname(files[0].path));
    const more = files.length - 1;
    const reply = ru
      ? `Нашёл «${name}» в папке «${folder}», ${you}.${more ? ` Есть ещё ${more} с похожим названием.` : ''} Открыть?`
      : `I found ${name} in ${folder}, ${you}.${more ? ` There ${more === 1 ? 'is 1 more' : `are ${more} more`} with a similar name.` : ''} Shall I open it?`;
    return { ...done(reply, [ru ? `Нашёл «${name}»` : `Found ${name}`],
      `found these files, newest first: ${files.slice(0, 5).map((f) => f.path).join(' ; ')}. I offered to open the first one; if he says yes, open it`),
    file: files[0].path };
  }
  return null;
}
