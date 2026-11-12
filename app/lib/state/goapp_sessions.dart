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

/// A fresh conversation id for one goapp.
///
/// No uuid package in the App, and a goapp conversation only has to be unique
/// among the goapps a phone opens — not globally.
String mintGoappSession() => 'goapp-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';

/// One conversation of one goapp.
///
/// [id] is the App's own scope id — `NativePanelView` keys a panel's data by
/// `(panel, session)` — not a DSH session id: a goapp is plugin UI, so the Host
/// never learns these and dropping one here cannot touch the Host's sessions.
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

/// The conversations of every goapp, kept apart from the chat list.
///
/// A goapp opening from a launcher icon must not resume whatever conversation
/// the chat tab was left in, so each goapp owns a list and a default. A plain
/// object rather than a `Notifier` on purpose: opening a goapp is a read that
/// must not depend on who is listening, and the whole list is small enough to
/// write on every change.
class GoappSessionsStore {
  GoappSessionsStore({DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  static const preferenceKey = 'goapp_sessions_v1';

  final DateTime Function() _clock;
  final Map<String, List<GoappSession>> _sessions = {};
  final Map<String, String> _current = {};
  Future<void> _pending = Future<void>.value();

  /// Newest first, by goapp package.
  List<GoappSession> sessionsOf(String package) => List.unmodifiable(_sessions[package] ?? const []);

  /// The conversation each goapp opens by default.
  String? currentOf(String package) => _current[package];

  /// The saved conversations are in. Failures leave the store empty: a broken
  /// preference must not stop a goapp from opening.
  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(preferenceKey);
      if (raw == null) return;
      for (final MapEntry(:key, :value) in (jsonDecode(raw) as Map).entries) {
        final package = key as String;
        final list = [
          for (final entry in (value['s'] as List? ?? const []))
            GoappSession(
              id: entry[0] as String,
              startedAt: DateTime.fromMillisecondsSinceEpoch(entry[1] as int),
            ),
        ];
        if (list.isEmpty) continue;
        _sessions[package] = list.take(goappSessionLimit).toList();
        final chosen = value['c'] as String?;
        if (chosen != null && list.any((s) => s.id == chosen)) _current[package] = chosen;
      }
    } catch (_) {
      _sessions.clear();
      _current.clear();
    }
  }

  /// The conversation [package] opens now, minting one through [mint] when it
  /// has none left. Callers pass the id, so the store keeps no randomness.
  String resolve(String package, String Function() mint) {
    final known = _current[package];
    if (known != null && (_sessions[package] ?? const <GoappSession>[]).any((s) => s.id == known)) return known;
    final existing = _sessions[package] ?? const <GoappSession>[];
    if (existing.isNotEmpty) {
      _current[package] = existing.first.id;
      return existing.first.id;
    }
    final id = mint();
    startNew(package, id);
    return id;
  }

  /// Starts a conversation and makes it the one [package] opens next time.
  void startNew(String package, String id) {
    final previous = (_sessions[package] ?? const <GoappSession>[]).where((s) => s.id != id);
    _sessions[package] = [GoappSession(id: id, startedAt: _clock()), ...previous].take(goappSessionLimit).toList();
    _current[package] = id;
    _save();
  }

  /// Opens [id] again; an id this goapp does not keep is ignored.
  void select(String package, String id) {
    if (!(_sessions[package] ?? const []).any((s) => s.id == id)) return;
    _current[package] = id;
    _save();
  }

  /// Drops [id]. When it was the default the newest remaining one takes over,
  /// so opening the goapp next time lands somewhere real instead of a blank.
  void forget(String package, String id) {
    final kept = _sessions[package] ?? const <GoappSession>[];
    final list = kept.where((s) => s.id != id).toList();
    if (list.length == kept.length) return;
    if (list.isEmpty) {
      _sessions.remove(package);
      _current.remove(package);
    } else {
      _sessions[package] = list;
      if (_current[package] == id) _current[package] = list.first.id;
    }
    _save();
  }

  /// Waits for the write that follows a change. Tests and the page's own
  /// teardown use it; nothing else has to.
  Future<void> flush() => _pending;

  void _save() {
    final payload = <String, Object?>{
      for (final MapEntry(:key, :value) in _sessions.entries)
        key: {
          'c': ?_current[key],
          's': [
            for (final session in value) [session.id, session.startedAt.millisecondsSinceEpoch],
          ],
        },
    };
    final text = jsonEncode(payload);
    _pending = _pending.then((_) async {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(preferenceKey, text);
      } catch (_) {
        // The list still works for this run; the next change retries.
      }
    });
  }
}

/// One store per container. Nothing here is reactive: a goapp resolves its
/// conversation once when it opens.
final goappSessionsProvider = Provider<GoappSessionsStore>((ref) {
  final store = GoappSessionsStore();
  unawaited(store.load());
  return store;
});
