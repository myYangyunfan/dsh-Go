// View + data for the manager panel. `data.*` is filled by goappData, so a
// toggle pushes a small patch instead of a new view.
const WORDS = {
  zh: {
    installed: '已安装',
    enabled: '已启用',
    store: '商店',
    empty: '还没有 goapp。在商店安装，或从本地导入一个。',
    hint: '开启后可从桌面快捷方式直接进入；删除会连同它的会话一起清掉。',
    refresh: '刷新',
    import: '导入',
    imported: '已导入',
    installed_one: '已安装',
    updated_one: '已更新',
    notDownloaded: '还没有下载这个包，先放进 inbox 再安装',
    downloadFailed: '下载失败',
    opening: '打开 goapp',
    openingBody: '桌面直达入口需要在 App 里注册；当前版本先在这里打开。',
    removed: '已删除',
  },
  en: {
    installed: 'Installed',
    enabled: 'Enabled',
    store: 'Store',
    empty: 'No goapps yet. Install one from the store, or import a local one.',
    hint: 'Enabled goapps can be opened from a home-screen shortcut; removing one deletes its sessions too.',
    refresh: 'Refresh',
    import: 'Import',
    imported: 'Imported',
    installed_one: 'Installed',
    updated_one: 'Updated',
    notDownloaded: 'Package not downloaded yet — put it in the inbox first',
    downloadFailed: 'Download failed',
    opening: 'Opening goapp',
    openingBody: 'The home-screen entry has to be registered by the app; for now it opens here.',
    removed: 'Removed',
  },
}

/** zh unless the app's locale says otherwise. */
export function words(locale) {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? WORDS.en : WORDS.zh
}

/** The panel structure. */
export function goappView(scope, caps) {
  const w = words(caps?.locale)
  return {
    type: 'stack',
    children: [
      {
        type: 'row',
        children: [
          { type: 'metric', label: w.installed, value: { $: 'data.installed' } },
          { type: 'metric', label: w.enabled, value: { $: 'data.enabled' }, tone: 'good' },
        ],
      },
      { type: 'list', items: { $: 'data.items' } },
      { type: 'text', text: w.hint, tone: 'muted' },
      { type: 'text', text: w.store, tone: 'muted' },
      { type: 'list', items: { $: 'data.store' } },
      {
        type: 'actions',
        items: [
          { label: w.import, icon: 'download', action: 'import' },
          { label: w.refresh, icon: 'refresh', action: 'refresh' },
        ],
      },
    ],
  }
}

/**
 * The data the view binds to. Language-neutral: ids, names and numbers only.
 * @param {{ goapps: Array<any> }} registry
 * @param {{ goapps: Array<any> }} [store]
 */
export function goappData(registry, store) {
  const goapps = Array.isArray(registry?.goapps) ? registry.goapps : []
  const catalog = Array.isArray(store?.goapps) ? store.goapps : []
  const have = new Set(goapps.map((g) => g.id))
  return {
    installed: String(goapps.length),
    enabled: String(goapps.filter((g) => g.enabled).length),
    items: goapps.map((g) => ({
      title: g.name,
      subtitle: `${g.version} · ${g.enabled ? '●' : '○'}`,
      trailing: g.sessions.length === 0 ? '' : String(g.sessions.length),
      icon: 'plugin',
      tone: g.enabled ? 'good' : 'muted',
      action: { id: 'open', args: { id: g.id } },
    })),
    store: catalog
      .filter((g) => !have.has(g.id))
      .map((g) => ({
        title: g.name,
        subtitle: g.summary,
        trailing: g.version,
        icon: 'download',
        action: { id: 'install', args: { id: g.id } },
      })),
  }
}

/** The empty-state line, for the panel when nothing is installed. */
export function emptyState(locale) {
  return { text: words(locale).empty }
}
