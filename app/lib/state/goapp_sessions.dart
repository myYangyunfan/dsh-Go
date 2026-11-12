import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// How many conversations one goapp keeps before the oldest is dropped.
///
/// A goapp is opened from a launcher icon over and over, so its list would grow
/// forever and every entry would be restored at launch. Twenty is far past what
/// someone scrolls through on a phone and keeps the restored state small.
const goappSessionLimit = 20;

/// One conversation of one goapp.
///
/// [id] is the App's own scope id — `NativePanelView` keys a panel's data by
/// `(panel, session)` — not a DSH session id: a goapp is plugin UI, so the Host
/// never learns these and deleting one here cannot touch the Host's sessions.
class GoappSession {
  const GoappSession({required this.id, required this.startedAt});

  final String id;
  final DateTime startedAt;

  @override
  bool operator ==(Object other) => other is GoappSession && other.id == id && other.startedAt == startedAt;

  @override
  int get hashCode => Object.hash(id, startedAt);

  @override
  String toString() => 'GoappSession($id)';
}

class GoappSessionsState {
  const GoappSessionsState({this.sessions = const {}, this.current = const {}, this.loaded = false});

  /// Newest first, by goapp package.
  final Map<String, List<GoappSession>> sessions;

  /// The conversation each goapp opens by default.
  final Map<String, String> current;

  /// The saved conversations are in (they arrive a moment after launch).
  final bool loaded;

  List<GoappSession> of(String package) => sessions[package] ?? const [];

  String? currentOf(String package) => current[package];
}

/// The conversations of every goapp, kept apart from the chat list.
///
/// A goapp opening from a launcher icon must not resume whatever conversation
/// the chat tab was left in, so each goapp owns a list and a default.
class GoappSessions extends Notifier<GoappSessionsState> {
  static const preferenceKey = 'goapp_sessions_v1';

  Timer? _write;

  @override
  GoappSessionsState build() {
    ref.onDispose(() => _write?.cancel());
    unawaited(_restore());
    return const GoappSessionsState();
  }

  Future<void> _restore() async {
    var restored = const <String, List<GoappSession>>{};
    var current = const <String, String>{};
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(preferenceKey);
      if (raw != null) {
        final sessions = <String, List<GoappSession>>{};
        final defaults = <String, String>{};
        for (final MapEntry(:key, :value) in (jsonDecode(raw) as Map).entries) {
          final package = key as String;
          final list = [
            for (final entry in (value['s'] as List? ?? const []))
              GoappSession(
                id: entry[0] as String,
                startedAt: DateTime.fromMillisecondsSinceEpoch(entry[1] as int),
              ),
          ];
          if (list.isNotEmpty) sessions[package] = list;
          final chosen = value['c'] as String?;
          if (chosen != null && list.any((s) => s.id == chosen)) defaults[package] = chosen;
        }
        restored = sessions;
        current = defaults;
      }
    } catch (_) {
      // No preferences backend (tests) or an unreadable value: start empty.
    }
    if (!ref.mounted) return;
    // A conversation opened before the load finished wins over the saved one.
    state = GoappSessionsState(
      sessions: {
        ...restored,
        for (final MapEntry(:key, :value) in state.sessions.entries) key: value,
      },
      current: {...current, ...state.current},
      loaded: true,
    );
  }

  /// The conversation [package] opens now, minting one through [mint] when it
  /// has none left. Callers pass the id, so this stays free of clocks.
  String resolve(String package, String Function() mint) {
    final known = state.currentOf(package);
    if (known != null && state.of(package).any((s) => s.id == known)) return known;
    final existing = state.of(package);
    if (existing.isNotEmpty) {
      _publish(package, existing, existing.first.id);
      return existing.first.id;
    }
    final id = mint();
    startNew(package, id);
    return id;
  }

  /// Starts a conversation and makes it the one [package] opens next time.
  void startNew(String package, String id, {DateTime? now}) {
    final list = [GoappSession(id: id, startedAt: now ?? DateTime.now()), ...state.of(package)]
      ..removeWhere((s) => s.id == id);
    _publish(package, list.take(goappSessionLimit).toList(), id);
  }

  /// Opens [id] again; an id this goapp does not keep is ignored.
  void select(String package, String id) {
    if (!state.of(package).any((s) => s.id == id)) return;
    _publish(package, state.of(package), id);
  }

  /// Drops [id]. When it was the default, the newest remaining one takes over,
  /// so opening the goapp next time lands somewhere real instead of a blank.
  void forget(String package, String id) {
    final kept = state.of(package);
    final list = kept.where((s) => s.id != id).toList();
    if (list.length == kept.length) return;
    final next = state.currentOf(package) == id ? (list.isEmpty ? null : list.first.id) : state.currentOf(package);
    _publish(package, list, next);
  }

  void _publish(String package, List<GoappSession> list, String? current) {
    final sessions = {...state.sessions};
    final defaults = {...state.current};
    if (list.isEmpty) {
      sessions.remove(package);
      defaults.remove(package);
    } else {
      sessions[package] = list;
      if (current == null) {
        defaults.remove(package);
      } else {
        defaults[package] = current;
      }
    }
    state = GoappSessionsState(sessions: sessions, current: defaults, loaded: state.loaded);
    _schedule();
  }

  void _schedule() {
    _write?.cancel();
    _write = Timer(const Duration(milliseconds: 400), () => unawaited(_writeNow()));
  }

  Future<void> _writeNow() async {
    final payload = <String, Object?>{
      for (final MapEntry(:key, :value) in state.sessions.entries)
        key: {
          if (state.current[key] case final current?) 'c': current,
          's': [
            for (final session in value) [session.id, session.startedAt.millisecondsSinceEpoch],
          ],
        },
    };
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(preferenceKey, jsonEncode(payload));
    } catch (_) {
      // Nothing to do: the list still works for this run.
    }
  }
}

final goappSessionsProvider = NotifierProvider<GoappSessions, GoappSessionsState>(GoappSessions.new);
