import type { Messages } from './vi';

/**
 * Bản tiếng Anh. Chú thích kiểu `: Messages` là CỔNG — không phải tài liệu.
 *
 * ĐO ĐƯỢC ngày 2026-08-22 trong chính `apps/web`, chép nguyên văn, hai chiều —
 * tệp bị đột biến rồi khôi phục trong CÙNG một lệnh shell, `shasum` khớp cả
 * trước lẫn sau (c7e1c51d…):
 *
 *   XOÁ một khoá (`'lang.switcher.label'`):
 *
 *     src/i18n/messages/en.ts(21,14): error TS2741: Property
 *     ''lang.switcher.label'' is missing in type '{ 'lang.name.vi': string;
 *     'lang.name.en': string; 'library.courseCount': (count: number) => string;
 *     }' but required in type '{ 'lang.name.vi': string; 'lang.name.en':
 *     string; 'lang.switcher.label': string; 'library.courseCount': (count:
 *     number) => string; }'.
 *
 *     mã thoát THÔ: 2
 *
 *   THÊM một khoá (`'lang.name.fr'`):
 *
 *     src/i18n/messages/en.ts(25,3): error TS2353: Object literal may only
 *     specify known properties, and ''lang.name.fr'' does not exist in type
 *     '{ 'lang.name.vi': string; … }'.
 *
 *     mã thoát THÔ: 2
 *
 *   Sau khi khôi phục: mã thoát THÔ 0.
 *
 * Hai catalog không trôi dạt được theo chiều nào cả. Và vì `make test-web` từ
 * task này chạy `bun run typecheck` trước vitest, cổng ấy có mặt thật chứ không
 * chỉ tồn tại khi ai đó nhớ gõ `tsc` bằng tay.
 */
export const en: Messages = {
  // Giống hệt bản tiếng Việt, có chủ ý — xem chú thích `lang.name.*` ở `vi.ts`.
  'lang.name.vi': 'Tiếng Việt',
  'lang.name.en': 'English',

  'lang.switcher.label': 'Interface language',

  /**
   * Luật số nhiều nằm TRONG bản dịch, và đây là chỗ nó chứng minh mình cần
   * thiết: tiếng Việt không đổi danh từ theo số, tiếng Anh thì có. Một chuỗi
   * `'{count} courses'` sẽ cho ra "1 courses".
   */
  'library.courseCount': (count: number) => (count === 1 ? '1 course' : `${count} courses`),

  /* ── trang CÀI ĐẶT (`pages/Settings.tsx`) ─────────────────────────────── */

  'settings.nav.aria': 'Settings sections',
  'settings.section.account': 'Account',
  'settings.section.appearance': 'Language & appearance',
  'settings.section.localData': 'Data on this device',
  'settings.section.general': 'General',
  'settings.lede': 'Your account, how the app looks, and what is sitting on this machine.',
  'settings.account.syncBlurb': 'Progress syncs through this account.',
  'settings.appearance.themeLight': 'Light',
  'settings.appearance.themeDark': 'Dark',
  'settings.localData.statNotes': 'notes',
  'settings.localData.statBytes': 'in use',
  'settings.localData.statsAria': 'What this machine is holding',

  'settings.account.loading': 'Asking the server who is signed in…',
  'settings.account.unknown': 'Could not load your account details. This part needs the network.',
  'settings.account.signedInAs': (name: string, email: string) => `Signed in as ${name} · ${email}`,
  /**
   * "downloaded packages" dropped at fix-round-1 (task-14) — see vi.ts's
   * comment. Comma before "and" dropped at fix-round-2: leftover from when
   * this was a three-item list; two items don't need it.
   */
  'settings.account.signOutWarning':
    'Signing out erases the study data of this session from this browser: notes and the progress queue that has not been sent yet. That is the only way two people sharing one machine never see data belonging to the other.',

  'settings.appearance.blurb': 'Applies to the app frame. Course content keeps its own language.',
  'settings.appearance.language': 'Language',
  'settings.appearance.theme': 'Appearance',
  'settings.appearance.themeNowLight': 'Currently using the light theme.',
  'settings.appearance.themeNowDark': 'Currently using the dark theme.',

  /** Rewritten at fix-round-1 (task-14) — see vi.ts's comment. */
  'settings.localData.blurb': 'Notes live in this browser. Courses aren’t downloaded as packages — they’re read straight from the server.',
  'settings.localData.clearedOnSignOut':
    'The local database is named after the BROWSER, not the user — so it is wiped whenever a different person signs in, even if nobody signed out.',
  'settings.localData.kept': 'Language and theme stay: they belong to the device.',

  /* AI section — Phase 2 (task-14): credit + agent config replace the key
     vault frame. See vi.ts for the full rationale; no string below may say
     "key", "vault", or "separate address" again — all three went false the
     moment AI moved server-side (Task 11). */

  'settings.ai.title': 'AI assistant',
  'settings.ai.blurb':
    'The AI assistant runs on our own servers and is paid for with your account credit — there is no key left for you to paste or keep.',

  /* `CreditPanel.tsx` — balance and recent usage, GET /ai/credits */

  'settings.ai.creditTitle': 'Credit',
  'settings.ai.creditBalanceLabel': 'Available credit',
  'settings.ai.creditLoading': 'Reading your balance…',
  'settings.ai.creditError': 'Could not read your credit balance. Try reloading the page.',
  'settings.ai.usageTitle': 'Recent usage',
  'settings.ai.usageEmpty': 'No charged questions yet.',
  'settings.ai.usageColWhen': 'When',
  'settings.ai.usageColModel': 'Model',
  'settings.ai.usageColTokensIn': 'Tokens in',
  'settings.ai.usageColTokensCached': 'Tokens in (cached)',
  'settings.ai.usageColTokensOut': 'Tokens out',
  'settings.ai.usageColToolCalls': 'Tool calls',
  'settings.ai.usageColWebSearches': 'Web searches',
  'settings.ai.usageColCredits': 'Credit charged',

  /* `AgentConfigPanel.tsx` — personal prompt and tool toggles,
     GET/PUT /ai/config */

  'settings.ai.configTitle': 'Agent configuration',
  'settings.ai.configBlurb':
    'Your personal prompt is added to EVERY question you ask — use it to tell the assistant how you want to be answered.',
  'settings.ai.configLoading': 'Reading configuration…',
  'settings.ai.configError': 'Could not read the agent configuration. Try reloading the page.',
  'settings.ai.promptLabel': 'Your personal prompt',
  'settings.ai.promptPlaceholder': 'For example: always answer briefly, with a Python example.',
  'settings.ai.promptCounter': (count: string, max: string) => `${count} / ${max} characters`,
  'settings.ai.promptTooLong':
    'This prompt is longer than the allowed limit. Shorten it to save — the server will reject anything longer than this even if you press Save.',
  'settings.ai.toolsTitle': 'Agent tools in use',
  'settings.ai.toolReadCourse': 'Read course content',
  'settings.ai.toolWebSearch': 'Search the web',
  'settings.ai.save': 'Save configuration',
  'settings.ai.saved': 'Saved.',
  'settings.ai.saveUnknownTool': 'One of the listed tools no longer exists. Reload the page and try again.',
  'settings.ai.saveRejected': 'The server rejected this configuration. Try again in a moment.',

  /* ══════════════════════════════════════════════════════════════════════ *
   * VỎ ỨNG DỤNG (`shell/`)
   * ══════════════════════════════════════════════════════════════════════ */

  /** Tên riêng của nền tảng — giữ nguyên ở cả hai bản, như mọi tên riêng. */
  'app.name': 'Tự học',

  'nav.aria.main': 'Main navigation',
  'nav.continue': 'Continue',
  'nav.courses': 'Courses',
  'nav.progress': 'Progress',
  'account.settings': 'Settings',
  'nav.dashboard': 'Dashboard',
  'nav.library': 'Library',
  'nav.import': 'Import a course',

  'sidebar.searchPlaceholder': 'Find a chapter…',
  'sidebar.progressPlaceholder': 'Progress will appear here',
  'sidebar.noCourseLoaded': 'No course is loaded.',

  'topbar.menu': 'Open the menu',
  'topbar.searchPlaceholder': 'Search courses, chapters…',
  'topbar.searchOpen': 'Open search',
  'topbar.searchClose': 'Close search',
  'topbar.searchSoon': 'Search is not wired up yet — coming soon.',
  'account.menuAria': 'Account menu',
  'topbar.markRead': 'Mark as read',
  'topbar.themeToLight': 'Switch to the light theme',
  'topbar.themeToDark': 'Switch to the dark theme',
  'topbar.prevChapter': 'Previous chapter',
  'topbar.nextChapter': 'Next chapter',

  'rail.inChapter': 'In this chapter',
  'rail.empty': 'Nothing here yet.',

  'error.boundary.log': 'ErrorBoundary caught a render error:',
  'error.boundary.title': 'This screen hit an error',
  'error.boundary.body':
    'The rest of the app is still running. Reloading the page is usually enough; if the error comes back, the details below are what to include in a bug report.',
  'error.boundary.reload': 'Reload the page',

  /* ══════════════════════════════════════════════════════════════════════ *
   * TRANG (`pages/`)
   * ══════════════════════════════════════════════════════════════════════ */

  'course.loading': 'Loading the course…',
  'course.notFound': 'Course not found.',
  'course.parts.title': (n: string) => `This course runs through ${n} parts`,
  'course.parts.hint': 'Each chapter is listed in the contents on the left.',
  'course.partCount': (read: string, total: string) => `${read}/${total}`,
  'chapter.notFound': 'Chapter not found.',
  'chapter.notFoundInCourse': 'That chapter is not in this course.',

  'home.title': 'Continue learning',
  'home.lede': 'Where you left off, and the notes you have been taking.',
  'account.logout': 'Sign out',
  'home.loading': 'Finding where you left off…',
  'home.eyebrow': 'Currently reading',
  'home.continue': 'Continue reading',
  'home.start': 'Start reading',
  'home.reread': 'Read again',
  'home.finished': 'You have read every chapter of this course.',
  'home.chapters': (read: string, total: string) => `${read}/${total} chapters read`,
  'home.chaptersUnknown': (read: string) => `${read} chapters read`,
  'home.progressAria': (percent: string) => `${percent}% complete`,
  'home.notes.title': 'Recent notes',
  'home.notes.loading': 'Loading your notes…',
  'home.notes.empty': 'No notes yet. Select a passage while reading to write one.',
  'home.notes.open': 'Open the chapter',
  'home.notes.formula': 'formula',
  'home.notes.aria': (course: string) => `Open this note in ${course}`,

  /** Dashboard empty state, after the import flow died — see vi.ts's comment. */
  'home.empty.heading': 'You have not started a course yet',
  'home.empty.lede': 'Every course is readable right away — no import, no download to wait for.',
  'home.empty.cta': 'Browse the course catalog',

  'progress.lede': 'Your study figures, told as a sentence.',
  'progress.loading': 'Loading your progress…',
  'progress.error': 'Could not load progress. These figures live on the server, so this part needs a connection.',
  'progress.sentence': (minutes: string, streak: string) =>
    `You have studied ${minutes} minutes, on a ${streak}-day streak.`,
  'progress.sentenceNoStreak': (minutes: string) =>
    `You have studied ${minutes} minutes. No streak is running right now — study today and one starts again.`,
  'progress.sentenceEmpty': 'No study time recorded yet. Open a chapter and read; the figures start there.',
  'progress.heat.title': 'The last seven weeks',
  'progress.heat.aria': 'The last seven weeks, one cell per day',
  'progress.heat.cell': (date: string, minutes: string) => `${date}: ${minutes} min`,
  'progress.year.title': (days: string, year: string) => `${days} days studied in ${year}`,
  'progress.year.courses': 'Courses this year',
  'progress.year.noCourses': (year: string) => `No study sessions recorded in ${year}.`,
  'progress.year.pickAria': 'Pick a year',
  'progress.year.error': 'Could not load this year’s calendar.',
  'progress.heat.day': (date: string, minutes: string) => `${date}: ${minutes} min`,
  'progress.heat.noData': (date: string) => `${date}: outside the window the server reports`,
  'progress.heat.less': 'less',
  'progress.heat.more': 'more',
  'progress.byCourse': 'By course',
  'progress.stat.chapters': 'Chapters read',
  'progress.stat.chaptersSub': (n: string) => `across ${n} courses on this device`,
  'progress.stat.streak': 'Day streak',
  'progress.stat.streakSub': 'as of today',
  'progress.stat.notes': 'Notes written',
  'progress.stat.notesSub': 'kept on this device',
  /** Rewritten at fix-round-2 (task-14) — see vi.ts's comment for why, and for why this stops right before "Courses" rather than repeating it. */
  'progress.noCourses': 'Nothing to measure yet. Start reading under',
  'progress.chaptersDone': (n: string) => `${n} chapters read`,
  'progress.course.chapters': (read: string, total: string) => `${read}/${total} chapters`,
  'progress.course.aria': (percent: string) => `${percent}% complete`,
  'progress.course.minutes': (minutes: string) => `${minutes} minutes studied`,

  'login.pitch.headline': 'Courses are open to everyone.',
  /** `login.pitch.lede` and `login.point.ownKey` rewritten at task-15 — see vi.ts's comment. */
  'login.pitch.lede':
    'Open a course and start reading right away — nothing to install, nothing to download. Highlight a passage to take a note right on the page, or ask the AI assistant right there.',
  /* Tên riêng "Tự học" KHÔNG đi vào đây: bài "en còn tiếng Việt" ở
     `i18n.test.ts` cho phép đúng hai khoá (`app.name`, `lang.name.vi`), và một
     nhãn trợ năng không đáng làm danh sách ấy dài thêm. */
  'login.pitch.aria': 'What this platform does',
  'login.point.free': 'Read every course free — no account needed',
  'login.point.ownKey': 'An AI assistant on our own servers, paid for with credit — no key of your own needed',
  'login.point.sync': 'Sign in and your progress and notes follow you across devices',

  'login.title': 'Sign in',
  'login.heading.login': 'Welcome back',
  'login.heading.register': 'Create an account',
  'login.lede': 'Your reading progress follows you between machines.',
  'login.tablist.aria': 'Sign in or register',
  'login.tab.login': 'Sign in',
  'login.tab.register': 'Register',
  'login.field.email': 'Email',
  'login.field.password': 'Password',
  'login.field.emailPlaceholder': 'you@example.com',
  'login.password.show': 'Show password',
  'login.password.hide': 'Hide password',
  /** Reframed at fix-round-1 (task-14) — see vi.ts's comment for why. */
  'login.reassure': 'Not signing in now costs you nothing — create an account whenever you actually want one.',
  'login.switch.noAccount': 'No account yet?',
  'login.switch.hasAccount': 'Already have an account?',
  'login.switch.toRegister': 'Create an account',
  'login.switch.toLogin': 'Sign in',
  'login.field.name': 'Name',
  'login.submit.loggingIn': 'Signing in…',
  'login.submit.login': 'Sign in',
  'login.submit.registering': 'Registering…',
  'login.submit.register': 'Register',

  /** Tên riêng của một hiện vật, không phải từ chung — giữ nguyên ở cả hai bản. */
  'library.source.registry': 'registry',
  'library.source.private': 'private',
  'library.source.import': 'imported',
  'library.source.unknown': 'unknown source',

  /* ── the Courses screen (`pages/Courses.tsx`) — see vi.ts's comment ────── */
  'courses.title': 'Courses',
  'courses.lede': 'Every course, public — free to read, no account needed.',
  'courses.loading': 'Loading the catalog…',
  'courses.empty': 'No courses have been published yet.',
  'courses.list.aria': 'Course catalog',
  /** Last user: `pages/Library.tsx`'s `EmptyLibrary` — see vi.ts's comment. */
  'courses.import.action': 'Import a package',
  'library.loading': 'Loading your library…',
  'library.empty.headingOffline': 'No courses on this device',
  'library.empty.heading': 'Your library is empty',
  'library.list.aria': 'Your courses',
  'library.notice.server': (status: string) =>
    `The server answered but reported an error (HTTP ${status}), so the server-side library could not be loaded. Courses already stored on this device still appear below.`,
  'library.notice.offline':
    'Showing the copy stored on this device — the server never answered. You may be offline, or the server may be misconfigured (CORS/DNS): the browser returns the same empty error for both, so this page cannot tell them apart. Only courses stored on this device appear below.',
  'library.meta.version': (version: string) => `version ${version}`,
  'library.meta.held': 'downloaded',
  'library.meta.chapters': (read: string, total: string) => `${read}/${total} chapters`,
  'library.update.available': (version: string) => `New version available: v${version}`,
  'library.update.view': 'See what changed',
  'library.tier.contentTitle': 'Content tier: HTML, CSS, images and maths only — no JavaScript.',
  'library.tier.interactiveTitle':
    'Interactive tier (§1.2): this course is allowed to contain JavaScript, and that code runs in your browser as you read.',
  'library.tier.interactiveLabel': 'interactive — runs JavaScript',
  'library.tier.unknownTitle': 'This package declares no tier, so nothing guarantees it contains no JavaScript.',
  'library.tier.unknownLabel': 'unknown tier — may run code',
  'library.emptyState.lede': (app: string) =>
    `${app} deliberately ships no courses — you choose what you read. Start by importing a package.`,
  'library.emptyState.wayFile': (zip: string) => `a ${zip} file on this machine`,
  'library.emptyState.wayUrl': (zip: string) => `a link to a ${zip} file`,
  'library.emptyState.wayRepo': 'a public GitHub repository',
  'library.emptyState.registry':
    'The community course registry is being built — once it exists, it will appear right here.',

  'import.lede': (zip: string) =>
    `A course is a ${zip} package. Once imported, it lives on your device and reads fine offline.`,
  'import.way.file': 'From a file on this device',
  'import.way.filePick': 'Choose a .zip package',
  'import.way.zipUrl': 'From a .zip link',
  'import.way.zipUrlLabel': 'Link to the .zip file',
  'import.way.zipUrlSubmit': 'Import from the link',
  'import.way.repo': 'From a public GitHub repository',
  'import.way.repoLabel': 'Repository URL',
  'import.way.repoSubmit': 'Import from the repository',
  'import.way.repoNote': (publicWord: string, zip: string) =>
    `Only ${publicWord} repositories can be imported. Private repositories need an access token, and tuhoc deliberately does not hold your tokens. If the course lives in a private repository, download the repository’s ${zip} and use “From a file on this device” above — the result is identical.`,
  'import.way.repoNotePublic': 'public',
  'import.progress.files': (done: string, total: string) => ` ${done}/${total} files.`,
  'import.cancel': 'Cancel',
  'import.cancelled': 'The import was cancelled. Nothing was saved.',
  'import.done': (courseId: string, version: string) => `Imported ${courseId} version ${version}. `,
  'import.done.open': 'Open the course',
  'import.reroot': (folder: string, dropped: string) =>
    `The package sat inside the folder ${folder} of the file you chose, so tuhoc treated that folder as the package root${dropped}.`,
  'import.reroot.dropped': (count: string) => ` and skipped ${count} files outside it`,
  'import.failed.heading': 'This package could not be imported',
  'import.failed.one': 'One problem to fix:',
  'import.failed.many': (count: string) => `${count} problems, all listed here so you can fix them in one pass:`,
  'import.stage.fetching': 'Downloading the package…',
  'import.stage.unpacking': 'Unpacking…',
  'import.stage.checking': 'Checking the package contents…',
  'import.stage.saving': 'Saving to your device…',

  /* ══════════════════════════════════════════════════════════════════════ *
   * TRANG ĐỌC + GHI CHÚ + TRỢ LÝ AI
   * ══════════════════════════════════════════════════════════════════════ */

  'reader.markUnread': 'Mark as unread',
  'reader.read': 'Read',
  'reader.kitFailed': 'Could not load the reading tools (KaTeX/simulations). Try reloading the page.',
  'reader.chapterLoading': 'Loading the chapter…',
  'reader.askAi': 'Ask the AI about this chapter',
  'reader.askHeading': 'Ask about this chapter',
  'reader.prev': '← Previous chapter',
  'reader.next': 'Next chapter →',
  'reader.notesTab': (count: string) => `Notes (${count})`,
  'reader.exerciseCheckbox': (index: string) => `Mark exercise ${index} as done`,
  'reader.exerciseDone': 'Done',
  'reader.anonNudge': 'Sign in to keep progress, notes, and ask the AI.',

  'reader.toc': 'Contents',
  'reader.tocOpen': 'Open the course contents',
  'reader.tocClose': 'Close the contents',
  'reader.tocAria': 'Course contents',
  'reader.exit': 'Leave',
  'reader.exitAria': 'Leave reading mode — back to Keep reading',
  'reader.notesToggle': 'Show/hide the notes in the margin',
  'reader.tocEmpty': 'This course has no chapters yet.',
  'reader.tocHeadingsEmpty': 'This chapter has no sections.',

  'ann.color.yellow': 'Highlight in yellow',
  'ann.color.green': 'Highlight in green',
  'ann.color.blue': 'Highlight in blue',
  'ann.color.purple': 'Highlight in purple',
  'ann.saveFailed': 'Could not save the note. Try highlighting again.',
  'ann.toolbarAria': 'Annotate the selected passage',
  'ann.note': 'Note',
  'ann.deepDive': 'Go deeper',
  'ann.dismissAlert': 'Dismiss',

  'ann.card.collapsed': '▸ Inside a collapsed block',
  'ann.card.offPage': '▸ Not shown on the page',
  'ann.card.emptyNote': '(no text yet)',
  'ann.card.editorAria': 'Note text',
  'ann.card.delete': 'Delete the note',
  'ann.card.done': 'Done',
  'ann.card.none': 'No notes in this chapter yet.',
  'ann.card.sheetAria': 'Note',
  'ann.card.sheetClose': 'Close the note',

  'ann.orphan.reattachFailed': 'Could not reattach. Select the passage again and retry.',
  'ann.orphan.mathOnly':
    'The passage you selected is only a formula. Include some surrounding text so the note can find this place again.',
  'ann.orphan.awayAria': 'Notes that could not be reattached',
  'ann.orphan.awayBody': (count: string) =>
    `${count} notes could not be reattached. Open this chapter on a wider screen to reconnect them.`,
  'ann.orphan.awayHide': 'Hide',
  'ann.orphan.heading': (count: string) => `Orphaned (${count})`,
  'ann.orphan.lede':
    'The current version of the chapter no longer contains the passage these notes were anchored to. Their text is kept exactly as it was — press “Reattach”, then select the matching passage to reconnect it.',
  'ann.orphan.waiting': 'Select the matching passage in the chapter, then press “Attach here”.',
  'ann.orphan.reattach': 'Reattach',
  'ann.orphan.showExact': 'Show the original text',
  'ann.orphan.exactAria': 'The note’s original passage',
  'ann.orphan.copy': 'Copy',
  'ann.orphan.barAria': 'Reattach a note',
  'ann.orphan.barWhat': (quote: string) => `Reattaching: ${quote}`,
  'ann.orphan.barHint': 'Select the new passage in the chapter.',
  'ann.orphan.barConfirm': 'Attach here',
  'ann.orphan.barCancel': 'Cancel',

  'ai.panel.close': 'Close the assistant',
  'ai.panel.expand': 'Expand the ask panel',
  'ai.panel.resize': 'Drag to resize the panel',
  'ai.panel.collapse': 'Collapse the ask panel',
  // NOT "New conversation" (Phase 1's wording) — review round 1: the server
  // has no memory of any earlier turn (see useAI.ts's doc comment), so a
  // label implying a "conversation" that this button then "renews" claims a
  // continuity that was never there. It only clears what is drawn on screen.
  'ai.panel.newThread': 'Clear all',
  'ai.panel.thinking': 'Thinking…',
  // Persistent, not tied to any error — the panel says this BEFORE anything
  // has gone wrong, because it is true on the very first question too. See
  // useAI.ts's doc comment for why the server has no cross-turn memory.
  'ai.panel.noMemory': 'Each question stands on its own — the assistant does not remember earlier questions.',
  // `ai.panel.noCredit` is Phase 2's replacement for the Phase 1 pair
  // `needsSetup`/`unavailable` (removed — see `git log` on this file):
  // there is no per-device key to plug in anymore and no build variant
  // without the AI routes, so neither of those two states can occur. The
  // one blocking state left is running out of platform-issued credit.
  'ai.panel.noCredit':
    'You are out of AI credit on this account. Top up in settings to keep asking.',
  'ai.panel.openSettings': 'Open the settings page',
  'ai.panel.questionLabel': 'Your question',
  'ai.panel.questionPlaceholder': 'Ask about the chapter you are reading…',
  'ai.panel.stop': 'Stop',
  'ai.panel.ask': 'Ask',
  'ai.deepDive.heading': 'Go deeper',
  // Mười khoá dưới đây ứng với mười `ServerAIErrorCode` (`ai/serverClient.
  // ts`) — xem `useAI.ts`'s `describeFailure` cho quy tắc "mã nào dịch ra
  // câu nào", và VÌ SAO không câu nào ở đây là chuỗi thô server gửi.
  'ai.error.noCredit': 'You are out of AI credit. Top up to keep asking.',
  'ai.error.rateLimited': 'You are asking a bit fast — wait a moment and try again.',
  'ai.error.providerFailed': 'The AI provider could not complete this turn. Try again in a moment.',
  'ai.error.toolBudgetExhausted':
    'This question needed more lookup steps than this turn allows. Try asking something more specific, or turn off a tool.',
  'ai.error.unauthenticated': 'Your session has expired. Sign in again to keep asking.',
  // Own message, pulled OUT of the shared bucket below (review round 1):
  // unlike Internal/InvalidBody/etc., a learner (or a shorter chapter
  // context) can actually fix this by asking something shorter.
  'ai.error.fieldTooLong': 'Your question is too long, including the reading context. Ask something shorter, or select less text.',
  'ai.error.network': 'Could not reach the server. Check your connection and try again.',
  'ai.error.aborted': 'Cancelled.',
  // Chung cho `InvalidBody`/`FieldRequired`/`UnknownTool`/`Internal` — bốn
  // mã báo lỗi ở chính trang chính hoặc máy chủ, không phải điều người học
  // gây ra hay có một hành động cụ thể để sửa.
  'ai.error.requestRejected': 'The request was rejected. Try again in a moment.',

  /**
   * Câu vai BẢO MÔ HÌNH TRẢ LỜI BẰNG NGÔN NGỮ NÀO — nên bản này không phải một
   * bản dịch trang trí: nó là thứ làm cho một người đọc tiếng Anh nhận được
   * câu trả lời tiếng Anh.
   */
  'ai.prompt.chapterRole': (cutMark: string) =>
    `You are a teaching assistant for a self-study textbook. Answer only from the chapter excerpt below. The excerpt may have been trimmed (marked ${cutMark}); if the question falls in a part that is not here, say so plainly and point at the matching section in the outline rather than guessing. Answer in English, concisely, and write formulas as LaTeX inside $…$.`,
  'ai.prompt.deepDiveRole':
    'You are a teaching assistant for a self-study textbook. The reader has just highlighted a passage and wants to understand exactly that passage more deeply. Explain what it says, why it holds, and give one concrete example. Answer in English, concisely, and write formulas as LaTeX inside $…$.',
  'ai.prompt.field.course': 'COURSE',
  'ai.prompt.field.chapter': 'CHAPTER',
  'ai.prompt.field.outline': 'SECTION OUTLINE',
  'ai.prompt.field.excerpt': 'CHAPTER EXCERPT',
  'ai.prompt.field.before': 'CONTEXT BEFORE',
  'ai.prompt.field.selection': 'SELECTED PASSAGE',
  'ai.prompt.field.after': 'CONTEXT AFTER',
  'ai.prompt.deepDiveQuestion': 'Please explain this passage in detail.',

  'update.error.courseKit':
    'Could not preview: the chapter renderer (maths) failed to load. Check your connection and try again.',
  'update.error.unsafe': (version: string, findings: string) =>
    `Cannot update: version ${version} contains running code, which no course may ship. ${findings}`,
  'update.error.versionUnavailable': (version: string) =>
    `Could not preview: version ${version} of this course could not be fetched.`,
  'update.summary.exact': (exact: string, total: string) => `${exact}/${total} notes stay exactly in place`,
  'update.summary.fuzzy': (count: string) => `${count} shifted slightly`,
  'update.summary.orphaned': (count: string) => `${count} lost their anchor`,
  'update.title': (courseTitle: string) => `Update “${courseTitle}”`,
  'update.previewing': 'Trying to reanchor your notes on the new version…',
  'update.noNotes': 'You have no notes in this course, so the update changes nothing for you.',
  'update.alreadyLost': (count: string, fromVersion: string) =>
    `Of those, ${count} notes had already lost their anchor before this — staying on v${fromVersion} would not save them either.`,
  'update.orphansKept': (notDeleted: string) =>
    `Notes that lose their anchor are ${notDeleted}. They move into the chapter’s “could not be reattached” list, word for word, so you can reconnect them by hand.`,
  'update.orphansKept.notDeleted': 'not deleted',
  'update.applying': 'Updating…',
  'update.confirm': 'Update',
  'update.stay': (fromVersion: string) => `Stay on v${fromVersion}`,

  /* ══════════════════════════════════════════════════════════════════════ *
   * CHUỖI LỖI
   * ══════════════════════════════════════════════════════════════════════ */

  'finding.undescribed': (where: string, detail: string) =>
    `The package has a problem with no description yet${where}: ${detail}`,
  'finding.EMPTY_PACKAGE': 'This package is empty — there are no files inside it.',
  'finding.TOO_LARGE': (mb: string) => `The package exceeds the ${mb} MB ceiling once unpacked.`,
  'finding.PATH_ESCAPE': 'A file in the package points outside the package directory. This package is not safe to open.',
  'finding.MANIFEST_MISSING': (manifest: string) =>
    `The package has no ${manifest} at its root — that is the file describing the course.`,
  'finding.MANIFEST_PARSE': (manifest: string) => `${manifest} is not valid JSON.`,
  'finding.MANIFEST_FIELD': (manifest: string) => `${manifest} is missing a required field, or that field has the wrong type.`,
  'finding.TIER_REMOVED':
    'This course’s manifest still has a "tier" field — the new format has no tiers any more. Remove it from manifest.json; interactive parts now live in a separate widget instead of being declared through "tier".',
  'finding.SEMVER': 'The course version number is not in X.Y.Z form.',
  'finding.RUNTIME_RANGE': 'The course requires a runtime version this app does not support.',
  'finding.DUPLICATE_CHAPTER_ID': 'Two chapters share the same id.',
  'finding.CHAPTER_FILE_MISSING': 'The table of contents names a chapter file that is not in the package.',
  'finding.SCRIPT_TAG':
    'This chapter contains a <script> tag. No course may ship running code — interactive parts live only in a widget, sandboxed in its own frame.',
  'finding.EVENT_HANDLER_ATTR':
    'This chapter has event-handler attributes (onclick, onerror…), which are executable code. No course may ship running code — interactive parts live only in a widget, sandboxed in its own frame.',
  'finding.JAVASCRIPT_URL':
    'This chapter has a javascript: link, which is executable code. No course may ship running code — interactive parts live only in a widget, sandboxed in its own frame.',
  'finding.EMBEDDED_FRAME':
    'This chapter embeds another page (iframe/embed/object). No course may ship running code — interactive parts live only in a widget, sandboxed in its own frame.',
  'finding.FORM_TAG':
    'This chapter has a <form> — a form sends data somewhere else. No course may ship running code — interactive parts live only in a widget, sandboxed in its own frame.',
  'finding.JS_FILE_IN_PACKAGE':
    'The package contains a loose JavaScript file. No course may ship running code — interactive parts live only in a widget, sandboxed in its own frame.',
  'finding.TAG_ATTR_FLOOD': 'An HTML tag in the package carries too many attributes to be a real document.',
  'finding.WIDGET_TOO_LARGE':
    'A widget in this course is heavier than the size limit allows. Trim its content, or move anything heavy (images, data) out of it.',
  'finding.WIDGET_LINE_TOO_LONG':
    'A widget’s code has a line that is too long — usually a sign it was minified or squeezed onto one line. Rewrite it as normal, wrapped lines.',
  'finding.WIDGET_BAD_NAME':
    'A widget’s name is not valid. Widget names may only use lowercase letters, digits and hyphens, and cannot be too long.',
  'finding.WIDGET_FORBIDDEN_API':
    'A widget in this course uses cookies or browser storage (localStorage…) — something a widget has no access to. Remove that code.',
  'finding.WIDGET_EXTERNAL_URL':
    'A widget in this course loads something from the network. A widget must be fully self-contained — remove that link, even if it is only in a comment.',
  'finding.WIDGET_EXTRA_FILE':
    'A widget in this course carries more than one file. A widget may only have a single file — merge the rest into it, or delete it.',
  'finding.WIDGET_MISSING':
    'A chapter refers to a widget this course does not have. Check the widget’s name, or add the widget to the package.',
  'finding.WIDGET_ORPHAN':
    'This course ships a widget that no chapter uses. Remove it if it is no longer needed, or add it to the chapter that needs it.',
  'finding.BAD_URL': 'This link cannot be used.',
  'finding.FETCH_FAILED': 'Could not download it.',
  'finding.FILE_READ_FAILED': 'Could not read the file you chose.',
  'finding.HTTP_ERROR': 'The server refused the request.',
  'finding.NOT_A_ZIP':
    'This file is not a readable .zip. Make sure you picked the course’s .zip package.',
  'finding.ZIP64_UNSUPPORTED': 'This .zip uses a part of the zip64 format that tuhoc cannot read yet.',
  'finding.ARCHIVE_INDEX_MISMATCH':
    'This package contains nested archives (a .zip inside — .docx, .xlsx and .pptx are all .zip), so the archive’s index and its byte stream disagree.',
  'finding.DUPLICATE_ENTRY': 'The package has two files with the same name, so there is no way to tell which is real.',
  'finding.PACKAGE_ROOT_AMBIGUOUS': 'It is unclear which course in this file is the one you meant to import.',
  'finding.UNPACKABLE_ENTRY': 'The repository has entries that cannot be packaged.',
  'finding.GIT_HOST_UNSUPPORTED': 'tuhoc can only import directly from GitHub.',
  'finding.GIT_REPO_UNREACHABLE': 'Could not open this repository.',
  'finding.GIT_PATH_NOT_FOUND': 'The repository opened, but the directory you pointed at was not found.',
  'finding.GIT_RATE_LIMITED': 'GitHub is temporarily blocking because of too many requests from your network.',
  'finding.GIT_BAD_RESPONSE': 'The answer that came back was not GitHub’s.',
  'finding.GIT_TREE_TRUNCATED':
    'This repository is too large to list in one request. Download the repository’s .zip and import from the file instead.',
  'finding.GIT_TOO_MANY_FILES': 'This repository has too many files to import directly.',
  'finding.WRITE_FAILED': 'Could not save the package into this browser’s storage.',
  'finding.CANCELLED': 'The import was cancelled. Nothing was saved.',
  'finding.UNEXPECTED':
    'Something unexpected went wrong during the import. Try again; if it persists, here are the technical details to report:',

  'import.detail.manyRoots': (count: string, roots: string) =>
    `this file contains ${count} courses (${roots}); import them one package at a time.`,
  'import.detail.httpStatus': (status: string) => `The server answered HTTP ${status}.`,
  'import.detail.fetchFailed': (cause: string) =>
    `You may be offline, or the server holding the file may not allow other pages to download it directly (CORS). The browser does not say which. (${cause})`,
  'import.detail.bodyCutOff': (cause: string) =>
    `The server started sending the file and the connection broke partway, so the download is incomplete. Try again — it usually works the second time. (${cause})`,
  'import.detail.privateRepo':
    'tuhoc can only import from PUBLIC Git repositories. A private repository needs an access token, and tuhoc deliberately does not hold your tokens — if the course lives in a private repository, download the repository’s .zip and use “From a file on this device”. The result is identical. GitHub answers the same way for a private repository and one that does not exist, so check the URL as well.',
  'import.detail.rateLimited': 'Try again in a few minutes, or download the repository’s .zip and import from the file.',
  'import.detail.githubStatus': (status: string) => `GitHub answered HTTP ${status}.`,
  'import.detail.captivePortal': (cause: string) =>
    `The server returned unreadable content where GitHub’s data should have been. If you are on public Wi-Fi, that network may be intercepting with a sign-in page — sign in to the network and try again. (${cause})`,
  'import.detail.subdirMissing': (ref: string, subdir: string) =>
    `The repository opened, but branch “${ref}” has no directory “${subdir}”. Check the URL.`,
  'import.detail.unpackable': (count: string) =>
    `${count} entries are symlinks or submodules; a course package holds only ordinary files. If you cannot fix this repository, download its .zip and use “From a file on this device”.`,
  'import.detail.tooManyFiles': (count: string, cap: string) =>
    `${count} files, the ceiling is ${cap}. Download the repository’s .zip and import from the file.`,
  'import.detail.repoDeclaredBytes': (bytes: string) => `The repository declares ${bytes} bytes.`,
  'import.detail.nestedArchive':
    'tuhoc requires an archive’s index and byte stream to agree name for name — that is the fence against “two-faced” archives, the kind a scanner reads one way and an unpacker another. Remove the nested archives from the package (or repack them as ordinary directories), then package it with `tuhoc pack`.',
  'import.detail.zip64':
    'tuhoc reads ordinary zip64 archives; this one uses the part tuhoc refuses to guess at — over 65,535 entries, an index past the 4 GiB mark, or a zip64 version-2 record. Package it with `tuhoc pack`.',
  'import.detail.bytesRead': (bytes: string) => `Stopped after reading ${bytes} bytes.`,
  'import.detail.otherHost':
    'For everywhere else, download the archive’s .zip and use “From a file on this device” — the result is identical.',
  'import.detail.fileGone': (cause: string) =>
    `The file may have been moved or changed, or the drive holding it may have been unmounted after you picked it. Pick the file again. (${cause})`,
  'import.detail.schemeOnly': 'Only links starting with http:// or https:// are accepted.',
  'import.detail.parenthetical': (cause: string) => `(${cause})`,

  'course.error.runtimeMismatch': (required: string, got: string) =>
    `Could not load the course: incompatible version (the app needs ${required}, the course declares “${got}”).`,
  'course.error.notFound': 'Could not load the course: not found on the server.',
  'course.error.http': (status: string) => `Could not load the course: the server reported an error (HTTP ${status}).`,
  'course.error.parse': 'Could not load the course: the course data is malformed.',
  'course.error.missingAsset':
    'Could not load the course: the package stored on this device is missing this chapter’s file. Import the package again.',
  'course.error.unknown': 'Could not load the course: an unknown error occurred.',

  'auth.error.badRequest': 'Invalid request. Please check what you entered.',
  'auth.error.credentials': 'Wrong email or password.',
  'auth.error.emailTaken': 'That email is already registered. Sign in, or use a different address.',
  'auth.error.tooManyAttempts': 'Too many attempts. Please wait a moment and try again.',
  'auth.error.serverDown': 'The server is having trouble. Please try again later.',
  'auth.error.unknown': 'An unknown error occurred. Please try again.',
  'auth.error.unreachable':
    'Could not reach the server. You may be offline, or the server may be misconfigured (CORS/DNS).',

  'registry.error.notConfigured':
    'No registry address is configured. Set the VITE_REGISTRY_URL environment variable (the registry’s base address, e.g. https://<org>.github.io/<repo>) at build time, or use the public registry once it exists.',
  'registry.error.unsupportedSchema': (found: string, supported: string) =>
    `The registry catalog uses format version ${found}, and the tuhoc build you are running only reads version ${supported}. The platform needs updating. The catalog is NOT read speculatively — guessing at an unknown format is the quietest way to be wrong.`,
  'registry.error.notJson': (contentType: string) =>
    `The registry address returned a web page rather than a catalog: the body of index.json is not JSON${contentType}. Usually the registry address is wrong, or the server served its own 404 page in place of the file.`,
  'registry.error.malformed': (missing: string) =>
    `The registry catalog parsed but is missing or mistyped at: ${missing}. This is a fault on the registry side, not on your machine.`,
  'registry.error.http': (status: string) =>
    `The registry answered ${status} for index.json. The registry address may be wrong, or the registry may be having trouble.`,
  'registry.error.unreachable':
    'Could not load the registry catalog. You may be offline, or the registry may be misconfigured (CORS/DNS).',

  'catalog.title': 'Course catalog',
  'catalog.lede': 'The community course store. Every package here has passed the same validation rules the platform runs.',
  'catalog.loading': 'Loading the catalog…',
  'catalog.empty': 'The registry has no courses yet. The catalog loaded fine — it is empty.',
  'catalog.listAria': 'Courses on the registry',
  'catalog.versionCount': (count: string) => `${count} versions`,

  /* ── HC-3: lọc theo ngôn ngữ ───────────────────────────────────────────── */

  'catalog.filter.lang': 'Course language',
  'catalog.filter.allLangs': 'All languages',
  'catalog.filter.count': (shown: string, total: string) => `Showing ${shown} of ${total} courses.`,

  /* ── HC-3: kéo về ──────────────────────────────────────────────────────── */

  'catalog.pull.action': 'Pull into your library',
  'catalog.pull.busy': (title: string) => `Pulling ${title}…`,
  'catalog.pull.done': (title: string, version: string) => `Pulled ${title} version ${version} onto this device. `,
  'catalog.pull.open': 'Open the course',
  'catalog.pull.failed': (title: string) => `Could not pull ${title}:`,

  /* ── hệ thống con 4: chấm sao ──────────────────────────────────────────── */

  'rating.yourVote': 'Your rating',
  // English pluralises; Vietnamese does not. That rule belongs in the
  // TRANSLATION, which is the whole reason a parameterised key is a function
  // here and not a string with a hole in it.
  'rating.star': (stars: number) => (stars === 1 ? '1 star' : `${stars} stars`),
  // The decimal separator is a translation decision: `4.5` here, `4,5` in
  // Vietnamese. A `toFixed(1)` at the call site would pin the dot for both.
  'rating.summary': (average: number, count: number) =>
    `${average.toFixed(1)}/5 · ${count === 1 ? '1 vote' : `${count} votes`}`,
  'rating.none': 'No votes yet',
  'rating.saving': 'Saving your rating…',
  'rating.saved': 'Your rating was saved.',
  'rating.error.rejected': 'The server refused this rating. A rating must be a whole number of stars from 1 to 5.',
  'rating.error.tooMany':
    'You have rated too many courses to add another. You can still change a rating you already gave.',
  'rating.error.serverDown': 'The server is having trouble, so your rating was not saved. Try again in a few minutes.',
  'rating.error.unknown': 'Your rating was not saved.',
  'rating.error.unreachable':
    'Your rating could not be sent. You may be offline, or this build of tuhoc runs without a server.',

  /* ── hệ thống con 4: thảo luận ─────────────────────────────────────────── */

  'discuss.toggle': 'Discussion',
  'discuss.loading': 'Loading the discussion…',
  'discuss.empty': 'No comments on this course yet.',
  'discuss.postOnGitHub': 'Post a comment on GitHub',
  'discuss.deletedAuthor': 'Deleted account',
  'discuss.reason.disabled':
    'This platform is not connected to a discussion repository yet, so there is nothing to read here. That is the normal state of this build, not a fault.',
  'discuss.reason.unavailable': 'The discussion could not be loaded from GitHub. The rest of this page works normally.',
  'discuss.reason.rateLimited':
    'The discussion could not be loaded: the platform has used up its GitHub requests for the last few minutes. Try opening it again shortly.',
  'discuss.reason.unknown': 'The discussion could not be loaded. The server gave a reason this build does not know.',
  'discuss.error': 'The discussion could not be loaded. The server’s answer could not be read.',

  /* ── runtime của trang đọc ─────────────────────────────────────────────── */

  'courseKit.vizMissing': (name: string) => `[simulation "${name}" is not ready]`,
  'courseKit.vizFailed': 'This simulation could not be built in your current browser.',

  /* ── quản trị — /admin ──────────────────────────────────────────────── */

  /**
   * `AdminNav.tsx` — shared sub-nav across the three `/admin/*` screens.
   * Task 17 adds these three keys alongside `AdminCredits`/`AdminPricing`,
   * so `AdminCourses` (Task 8/15) and the two new screens can reach each
   * other.
   */
  'admin.nav.aria': 'Admin sections',
  'admin.nav.courses': 'Courses',
  'admin.nav.credits': 'Users & credit',
  'admin.nav.pricing': 'Pricing & base prompt',

  'admin.title': 'Course administration',
  'admin.lede': 'Publish, unpublish, or roll back a course — the same validation rules `tuhoc pack` runs on the command line.',
  'admin.loading': 'Loading the list…',
  'admin.empty': 'No courses have been published yet.',

  'admin.table.slug': 'Slug',
  'admin.table.title': 'Title',
  'admin.table.version': 'Version',
  'admin.table.publishedAt': 'Published',
  'admin.table.actions': 'Actions',

  'admin.upload.heading': 'Publish a new package',
  'admin.upload.fileLabel': '.zip package',
  'admin.upload.slugLabel': 'Slug',
  'admin.upload.submit': 'Publish',
  'admin.upload.submitting': 'Publishing…',
  'admin.upload.success': (slug: string, version: number) => `Published ${slug}, version ${version}.`,

  'admin.findings.heading': (count: number) => (count === 1 ? '1 problem' : `${count} problems`),
  'admin.findings.code': 'Code',
  'admin.findings.path': 'Path',
  'admin.findings.detail': 'Detail',

  'admin.unpublish.button': 'Unpublish',
  'admin.unpublish.confirmPrompt': (slug: string) => `Unpublish "${slug}"? It will stop being publicly readable.`,
  'admin.unpublish.confirmYes': 'Unpublish this course',
  'admin.unpublish.confirmCancel': 'Cancel',

  'admin.rollback.label': 'Roll back to version',
  'admin.rollback.placeholder': 'Choose a version…',
  'admin.rollback.button': 'Roll back',
  'admin.rollback.versionOption': (version: number, current: boolean) => `v${version}${current ? ' (current)' : ''}`,
  'admin.rollback.success': (version: number) => `Rolled back to version ${version}.`,

  'admin.error.badRequest': 'Invalid request.',
  'admin.error.notFound': 'This course could not be found.',
  'admin.error.serverDown': 'The server is having trouble. Please try again later.',
  'admin.error.unknown': 'An unknown error occurred.',
  'admin.error.unreachable':
    'Could not connect to the server. You may be offline, or the server may be misconfigured (CORS/DNS).',

  /* ══════════════════════════════════════════════════════════════════════ *
   * AI ADMIN — Task 17, spec §7: `admin/AdminCredits.tsx` ("Users &
   * credit") and `admin/AdminPricing.tsx` ("Pricing & base prompt"), both
   * talking to the seven `/admin/ai/*` routes
   * (`apps/api/internal/ai/admin_handler.go`).
   * ══════════════════════════════════════════════════════════════════════ */

  'admin.ai.credits.title': 'Users & credit',
  'admin.ai.credits.lede':
    "Find a user, see their balance and usage ledger, and add or remove credit by hand — every manual adjustment requires a note and is recorded in the operations log.",
  'admin.ai.credits.searchLabel': 'Search by email',
  'admin.ai.credits.searchPlaceholder': 'e.g. jane@example.test',
  'admin.ai.credits.searchButton': 'Search',
  'admin.ai.credits.loading': 'Loading…',
  'admin.ai.credits.empty': 'No matching users found.',
  'admin.ai.credits.colEmail': 'Email',
  'admin.ai.credits.colRole': 'Role',
  'admin.ai.credits.colBalance': 'Credit balance',
  'admin.ai.credits.colActions': 'Actions',
  'admin.ai.credits.selectButton': 'View details',
  'admin.ai.credits.adjustTitle': 'Add or remove credit by hand',
  'admin.ai.credits.amountLabel': 'Amount (credits)',
  'admin.ai.credits.directionLabel': 'Direction',
  'admin.ai.credits.directionAdd': 'Add',
  'admin.ai.credits.directionSubtract': 'Remove',
  'admin.ai.credits.noteLabel': 'Note (required)',
  'admin.ai.credits.notePlaceholder': 'Why you are adjusting this — required, and recorded in the operations log.',
  'admin.ai.credits.adjustSubmit': 'Apply',
  'admin.ai.credits.adjustSubmitting': 'Applying…',
  'admin.ai.credits.adjustSuccess': 'Balance updated.',
  'admin.ai.credits.usageTitle': 'Recent usage',
  'admin.ai.credits.usageEmpty': 'No charged turns yet.',
  'admin.ai.credits.adjustmentsTitle': 'Manual adjustment history',
  'admin.ai.credits.adjustmentsEmpty': 'No manual adjustments for this account yet.',
  'admin.ai.credits.colWho': 'Acted by',
  'admin.ai.credits.colNote': 'Note',

  'admin.ai.pricing.title': 'Pricing & base prompt',
  'admin.ai.pricing.lede':
    "Edit the per-model credit conversion table and the agent's base prompt — changes take effect on the very next turn, no deploy required.",
  'admin.ai.pricing.tableTitle': 'Credit conversion table',
  'admin.ai.pricing.loading': 'Loading…',
  'admin.ai.pricing.colModel': 'Model',
  'admin.ai.pricing.colCostIn': 'Cost in (/1K)',
  'admin.ai.pricing.colCostCachedIn': 'Cost cache-in (/1K)',
  'admin.ai.pricing.colCostOut': 'Cost out (/1K)',
  'admin.ai.pricing.colCreditsIn': 'Credits in (/1K)',
  'admin.ai.pricing.colCreditsCachedIn': 'Credits cache-in (/1K)',
  'admin.ai.pricing.colCreditsOut': 'Credits out (/1K)',
  'admin.ai.pricing.colUpdatedAt': 'Updated at',
  'admin.ai.pricing.colActions': 'Actions',
  'admin.ai.pricing.rowNotePlaceholder': 'Why this rate changed (optional)',
  'admin.ai.pricing.save': 'Save',
  'admin.ai.pricing.saving': 'Saving…',
  'admin.ai.pricing.saved': 'Saved.',
  'admin.ai.pricing.promptTitle': 'Agent base prompt',
  'admin.ai.pricing.promptBlurb':
    "This prompt runs BEFORE every user's own personal prompt — it holds the tutor persona and the safety boundary, and must never be empty.",
  'admin.ai.pricing.promptLabel': 'Base prompt',
  'admin.ai.pricing.promptEmptyWarning': "The base prompt must not be empty — it is the agent's safety boundary.",
  'admin.ai.pricing.promptNoteLabel': 'Note (optional)',

  'admin.ai.error.fieldRequired': 'A required field is missing.',
  'admin.ai.error.amountRequired': 'The amount must not be empty or zero.',
  'admin.ai.error.amountOutOfRange': 'That amount is outside what a single adjustment allows.',
  'admin.ai.error.fieldTooLong': 'That text is longer than allowed.',
  'admin.ai.error.notFound': 'Not found.',
};
