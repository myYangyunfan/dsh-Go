import 'package:dsh_app/state/goapp_sessions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('a goapp that has never opened gets one conversation, and keeps it', () {
    final store = GoappSessionsStore();
    var minted = 0;
    String mint() => 'minted-${++minted}';

    expect(store.resolve('pkg-a', mint), 'minted-1');
    expect(store.resolve('pkg-a', mint), 'minted-1');
    expect(minted, 1);
    expect(store.sessionsOf('pkg-a').map((s) => s.id), ['minted-1']);
  });

  test('goapps never share a conversation', () {
    final store = GoappSessionsStore();
    expect(store.resolve('pkg-a', () => 'a'), 'a');
    expect(store.resolve('pkg-b', () => 'b'), 'b');
    expect(store.currentOf('pkg-a'), 'a');
    expect(store.currentOf('pkg-b'), 'b');
  });

  test('starting a conversation makes it the default and keeps the old one', () {
    final store = GoappSessionsStore();
    store.startNew('pkg-a', 'one');
    store.startNew('pkg-a', 'two');

    expect(store.sessionsOf('pkg-a').map((s) => s.id), ['two', 'one']);
    expect(store.resolve('pkg-a', () => 'unused'), 'two');
  });

  test('starting the same conversation twice does not duplicate it', () {
    final store = GoappSessionsStore();
    store.startNew('pkg-a', 'one');
    store.startNew('pkg-a', 'two');
    store.startNew('pkg-a', 'one');

    expect(store.sessionsOf('pkg-a').map((s) => s.id), ['one', 'two']);
  });

  test('selecting a conversation the goapp does not keep changes nothing', () {
    final store = GoappSessionsStore();
    store.startNew('pkg-a', 'one');
    store.select('pkg-a', 'other');

    expect(store.currentOf('pkg-a'), 'one');
  });

  test('forgetting the default falls back to the newest one left', () {
    final store = GoappSessionsStore();
    store.startNew('pkg-a', 'one');
    store.startNew('pkg-a', 'two');
    store.forget('pkg-a', 'two');

    expect(store.sessionsOf('pkg-a').map((s) => s.id), ['one']);
    expect(store.currentOf('pkg-a'), 'one');
  });

  test('forgetting the last conversation leaves no default to resume', () {
    final store = GoappSessionsStore();
    store.startNew('pkg-a', 'one');
    store.forget('pkg-a', 'one');

    expect(store.sessionsOf('pkg-a'), isEmpty);
    expect(store.currentOf('pkg-a'), isNull);
    // The next open starts over rather than resuming something deleted.
    expect(store.resolve('pkg-a', () => 'fresh'), 'fresh');
  });

  test('forgetting a conversation the goapp does not keep is a no-op', () {
    final store = GoappSessionsStore();
    store.startNew('pkg-a', 'one');
    store.forget('pkg-a', 'ghost');

    expect(store.sessionsOf('pkg-a').map((s) => s.id), ['one']);
  });

  test('only the newest $goappSessionLimit conversations survive', () {
    final store = GoappSessionsStore();
    for (var i = 0; i < goappSessionLimit + 5; i++) {
      store.startNew('pkg-a', 's$i');
    }

    final ids = store.sessionsOf('pkg-a').map((s) => s.id).toList();
    expect(ids.length, goappSessionLimit);
    expect(ids.first, 's${goappSessionLimit + 4}');
    expect(ids.contains('s0'), isFalse);
  });

  test('conversations and the default come back after a restart', () async {
    final first = GoappSessionsStore();
    first.startNew('pkg-a', 'one');
    first.startNew('pkg-a', 'two');
    first.select('pkg-a', 'one');
    await first.flush();

    final second = GoappSessionsStore();
    await second.load();

    expect(second.sessionsOf('pkg-a').map((s) => s.id), ['two', 'one']);
    expect(second.currentOf('pkg-a'), 'one');
  });

  test('an unreadable saved value starts empty instead of throwing', () async {
    SharedPreferences.setMockInitialValues({GoappSessionsStore.preferenceKey: 'not json'});
    final store = GoappSessionsStore();
    await store.load();

    expect(store.sessionsOf('pkg-a'), isEmpty);
    expect(store.currentOf('pkg-a'), isNull);
  });

  test('removing a goapp drops its conversations, and only its own', () async {
    final store = GoappSessionsStore();
    store.startNew('pkg-a', 'one');
    store.startNew('pkg-b', 'other');
    store.forgetPackage('pkg-a');

    expect(store.sessionsOf('pkg-a'), isEmpty);
    expect(store.currentOf('pkg-a'), isNull);
    expect(store.currentOf('pkg-b'), 'other');

    await store.flush();
    final reopened = GoappSessionsStore();
    await reopened.load();
    expect(reopened.sessionsOf('pkg-a'), isEmpty);
    expect(reopened.currentOf('pkg-a'), isNull);
    expect(reopened.currentOf('pkg-b'), 'other');
  });

  test('dropping a goapp that kept nothing changes nothing', () {
    final store = GoappSessionsStore();
    store.startNew('pkg-a', 'one');
    store.forgetPackage('pkg-b');

    expect(store.sessionsOf('pkg-a').map((s) => s.id), ['one']);
    expect(store.currentOf('pkg-a'), 'one');
  });
}
