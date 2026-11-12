// A goapp opened from outside the app: `dshgo://open/panel/<package>/<id>`.
//
// A goapp is a plugin with its own panel (plugins/goapp/SPEC.md §9), so a
// launcher shortcut only has to name that panel. This page resolves it through
// the same registry the native plugin pages use and shows it full screen —
// which is what lets a shortcut skip the home screen.
//
// The package may be scoped (`@scope/name`), so everything between `panel` and
// the last segment is the package; the last segment is the panel id.
//
// The page also owns the goapp's conversations: a goapp opened from a launcher
// icon must not resume whatever the chat tab was left in, and one someone uses
// every day piles them up. Keeping the list here — not in the plugin — means
// every goapp gets it without writing any of it.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/l10n.dart';
import '../../../plugins/native/native_model.dart';
import '../../../plugins/native/native_state.dart';
import '../../../state/goapp_sessions.dart';
import '../../common/app_sheet.dart';
import '../../shell/page_frame.dart';
import '../../theme/app_icons.dart';
import 'native_panel.dart';

/// The page a `dshgo://open/panel/…` link opens.
class GoappPanelPage extends ConsumerStatefulWidget {
  const GoappPanelPage({super.key, required this.package, required this.id, this.sessionId});

  final String package;
  final String id;
  final String? sessionId;

  @override
  ConsumerState<GoappPanelPage> createState() => _GoappPanelPageState();
}

class _GoappPanelPageState extends ConsumerState<GoappPanelPage> {
  /// The conversation this goapp opened in.
  ///
  /// Resolved once per page rather than per build: a goapp keeps its own list
  /// (see `GoappSessionsStore`), so opening it from the launcher resumes where
  /// it was instead of inheriting whatever conversation the chat tab was left in.
  late String _session;

  @override
  void initState() {
    super.initState();
    _session = widget.sessionId ?? ref.read(goappSessionsProvider).resolve(widget.package, mintGoappSession);
  }

  /// Switches the panel to another conversation. The surface is keyed by
  /// `(panel, session)` and is `autoDispose`, so the old one is released and the
  /// new one is read from the plugin — a conversation left behind costs nothing
  /// while the page stays open.
  void _switchTo(String id) {
    if (!mounted || id == _session) return;
    setState(() => _session = id);
  }

  Future<void> _showConversations() => showAppSheet<void>(
    context,
    isScrollControlled: true,
    builder: (_) => _GoappConversations(package: widget.package, current: _session, onSwitch: _switchTo),
  );

  @override
  Widget build(BuildContext context) {
    final panel = _panel(ref.watch(nativePanelsProvider));
    if (panel == null) {
      // Switched off, removed, or not loaded yet: name the panel that is
      // missing and stay a page, so the back arrow returns to the home screen.
      return AppPage.list(
        title: widget.package,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            child: Text(context.l10n.plugslotsIssueUnknownPage('panel:${widget.package}/${widget.id}')),
          ),
        ],
      );
    }
    return AppPage.list(
      title: panel.title,
      actions: [
        GlassIconButton(
          key: const ValueKey('goapp-conversations'),
          icon: AppIcons.history,
          tooltip: context.l10n.shellChatList,
          onPressed: _showConversations,
        ),
      ],
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          // A new key per conversation: the view is a fresh subtree, so nothing
          // (a text field's draft included) carries over from the old one.
          child: NativePanelView(key: ValueKey('goapp|${widget.package}|$_session'), panel: panel, sessionId: _session),
        ),
      ],
    );
  }

  NativePanel? _panel(List<NativePanel> panels) =>
      panels.where((p) => p.package == widget.package && p.id == widget.id).firstOrNull;
}

/// The conversations of one goapp: start another, go back to one, drop one.
///
/// Deleting only forgets the App-side id — the Host never learns these scopes
/// (see `goapp_sessions.dart`), so nothing on the other side is touched.
class _GoappConversations extends ConsumerStatefulWidget {
  const _GoappConversations({required this.package, required this.current, required this.onSwitch});

  final String package;
  final String current;
  final ValueChanged<String> onSwitch;

  @override
  ConsumerState<_GoappConversations> createState() => _GoappConversationsState();
}

class _GoappConversationsState extends ConsumerState<_GoappConversations> {
  GoappSessionsStore get _store => ref.read(goappSessionsProvider);

  void _open(String id) {
    Navigator.of(context).pop();
    widget.onSwitch(id);
  }

  void _start() {
    final id = mintGoappSession();
    _store.startNew(widget.package, id);
    _open(id);
  }

  void _forget(String id) {
    _store.forget(widget.package, id);
    // Deleting the conversation on screen: the newest one left takes over, and
    // with none left the goapp starts over rather than showing nothing.
    if (id == widget.current) widget.onSwitch(_store.resolve(widget.package, mintGoappSession));
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final sessions = _store.sessionsOf(widget.package);
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.shellChatList, style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            ListTile(
              key: const ValueKey('goapp-conversation-new'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(AppIcons.add),
              title: Text(l10n.commonNewChat),
              onTap: _start,
            ),
            const Divider(height: 1),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.only(top: 4),
                children: [
                  for (final session in sessions)
                    ListTile(
                      key: ValueKey('goapp-conversation|${session.id}'),
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        session.id == widget.current ? AppIcons.checkboxOn : AppIcons.checkboxOff,
                        color: session.id == widget.current ? theme.colorScheme.primary : null,
                      ),
                      title: Text(l10n.monthDay(session.startedAt)),
                      trailing: IconButton(
                        icon: const Icon(AppIcons.delete),
                        tooltip: l10n.commonDelete,
                        onPressed: () => _forget(session.id),
                      ),
                      onTap: () => _open(session.id),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
