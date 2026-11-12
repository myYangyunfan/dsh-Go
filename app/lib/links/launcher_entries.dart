// The ways in from outside the app other than links and
// shares — the launcher icon's long-press shortcuts (新对话, 语音输入, the
// three latest conversations), the Quick Settings tile (新对话), and a
// screenshot taken explicitly from the floating pet. Native
// side: android/.../shortcuts/ (EntryActivity, ShortcutsPlugin — MethodChannel
// `dsh/shortcuts`) and tile/NewChatTileService.kt. Routed by
// lib/ui/shell/system_entry_host.dart.

import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../l10n/l10n.dart';
import '../state/connection_state.dart';
import '../state/hosts_state.dart';
import '../state/sessions_state.dart';
import 'native_inbox.dart';

/// Where a launcher shortcut or the tile asked to go.
sealed class LauncherEntry {
  const LauncherEntry();

  /// One `entry` call's arguments; null for anything malformed.
  static LauncherEntry? parse(Object? raw) {
    if (raw is! Map) return null;
    final sessionId = raw['sessionId'];
    final host = raw['host'];
    final text = raw['text'] is String ? raw['text'] as String : '';
    final path = raw['path'];
    final goappPackage = raw['package'];
    final goappPanel = raw['panel'];
    return switch (raw['kind']) {
      'new' => NewChatEntry(text: text),
      'voice' => NewChatEntry(voice: true, text: text),
      'screenshot' when path is String && path.startsWith('/') && !path.contains('\u0000') => ScreenshotEntry(path),
      'chat' when sessionId is String && sessionId.isNotEmpty => OpenChatEntry(
        HostRef.decode(host is String ? host : null),
        sessionId,
      ),
      'goapp'
          when goappPackage is String &&
              goappPackage.isNotEmpty &&
              goappPanel is String &&
              goappPanel.isNotEmpty =>
        GoappEntry(goappPackage, goappPanel),
      _ => null,
    };
  }
}

/// A new conversation; [voice] starts dictation in its composer.
class NewChatEntry extends LauncherEntry {
  const NewChatEntry({this.voice = false, this.text = ''});

  final String text;

  final bool voice;
}

/// A pet screenshot in the app's private cache, authenticated by the native
/// entry bridge. It is attached to a new-chat draft, never sent automatically.
class ScreenshotEntry extends LauncherEntry {
  const ScreenshotEntry(this.path);

  final String path;
}

/// One of the recent conversations.
class OpenChatEntry extends LauncherEntry {
  const OpenChatEntry(this.host, this.sessionId);

  final HostRef host;
  final String sessionId;
}

/// A goapp's own panel, opened from its home-screen icon. A goapp is a plugin
/// with a panel that asked for `goapp` placement (plugins/goapp/SPEC.md).
class GoappEntry extends LauncherEntry {
  const GoappEntry(this.package, this.panel);

  final String package;
  final String panel;
}

/// A conversation as a launcher shortcut.
class RecentShortcut {
  const RecentShortcut({required this.sessionId, required this.title, required this.host});

  final String sessionId;
  final String title;
  final HostRef host;

  Map<String, Object?> toJson() => {'id': sessionId, 'title': title, 'host': host.encode()};

  @override
  bool operator ==(Object other) =>
      other is RecentShortcut &&
      other.sessionId == sessionId &&
      other.title == title &&
      other.host == host &&
      other.host.name == host.name;

  @override
  int get hashCode => Object.hash(sessionId, title, host);
}

/// One enabled goapp as a launcher shortcut.
class GoappShortcut {
  const GoappShortcut({required this.package, required this.panel, required this.title});

  final String package;
  final String panel;
  final String title;

  Map<String, Object?> toJson() => {
    'id': '$package/$panel',
    'title': title,
    'package': package,
    'panel': panel,
  };

  @override
  bool operator ==(Object other) =>
      other is GoappShortcut && other.package == package && other.panel == panel && other.title == title;

  @override
  int get hashCode => Object.hash(package, panel, title);
}

/// The native bridge: entries in, recent conversations out.
class LauncherBridge extends NativeInbox<LauncherEntry> {
  LauncherBridge({MethodChannel? channel})
    : super(channel ?? const MethodChannel('dsh/shortcuts'), method: 'entry', parse: LauncherEntry.parse);

  Stream<LauncherEntry> get entries => stream;

  /// What the launcher has, as far as this run knows.
  List<RecentShortcut>? _published;
  List<GoappShortcut> _goapps = const [];

  /// Publishes [recents] (newest first) and [goapps] unless the launcher already
  /// has them. True when the launcher has them now.
  Future<bool> setRecent(
    List<RecentShortcut> recents, {
    List<GoappShortcut> goapps = const [],
  }) async {
    if (_published != null && listEquals(_published, recents) && listEquals(_goapps, goapps)) {
      return true;
    }
    try {
      final ok = await channel.invokeMethod<bool>('setRecent', {
        'items': [for (final r in recents) r.toJson()],
        if (goapps.isNotEmpty) 'goapps': [for (final g in goapps) g.toJson()],
      });
      // Refused while rate-limited: the next change tries again.
      if (ok ?? false) {
        _published = List.unmodifiable(recents);
        _goapps = List.unmodifiable(goapps);
      }
      return ok ?? false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }
}

final launcherBridgeProvider = Provider<LauncherBridge>((ref) {
  final bridge = LauncherBridge();
  ref.onDispose(bridge.dispose);
  return bridge;
});

/// At most this many conversations on the launcher.
const maxRecentShortcuts = 3;

/// The active host's latest conversations, for the launcher. Null while that
/// isn't known (not connected, the list loading): the launcher keeps what it
/// shows rather than being emptied by a stopped engine.
final recentShortcutsProvider = Provider<List<RecentShortcut>?>((ref) {
  final connected = ref.watch(activeConnectionProvider.select((c) => c.value != null));
  if (!connected) return null;
  final sessions = ref.watch(sessionsProvider);
  if (sessions.isLoading || !sessions.hasValue || sessions.hasError) {
    return null;
  }
  final host = ref.watch(activeHostProvider);
  return [
    for (final s in sessions.value!.take(maxRecentShortcuts))
      RecentShortcut(
        sessionId: s.sessionId,
        // The drawer's fallback (ui/shell/sessions_drawer.dart `sessionTitle`).
        title: switch (s.title?.trim()) {
          final t? when t.isNotEmpty => t,
          _ => appL10n.commonUntitledChat,
        },
        host: host,
      ),
  ];
});
