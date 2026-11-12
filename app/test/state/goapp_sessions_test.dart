import 'package:dsh_app/state/goapp_sessions.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  ProviderContainer make() {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    return container;
  }

  GoappSessions store(ProviderContainer container) => container.read(goappSessionsProvider.notifier);
  GoappSessionsState state(ProviderContainer container) => container.read(goappSessionsProvider);

  test('a goapp that has never opened gets one conversation, and keeps it', () {
    final container = make();
    var minted = 0;
    String mint() => 'minted-${++minted}';

    expect(store(container).resolve('pkg-a', mint), 'minted-1');
    expect(store(container).resolve('pkg-a', mint), 'minted-1');
    expect(minted, 1);
    expect(state(container).of('pkg-a').map((s) => s.id), ['minted-1']);
  });

  test('goapps never share a conversation', () {
    final container = make();
    expect(store(container).resolve('pkg-a', () => 'a'), 'a');
    expect(store(container).resolve('pkg-b', () => 'b'), 'b');
    expect(state(container).currentOf('pkg-a'), 'a');
    expect(state(container).currentOf('pkg-b'), 'b');
  });

  test('starting a conversation makes it the default and keeps the old one', () {
    final container = make();
    store(container).startNew('pkg-a', 'one');
    store(container).startNew('pkg-a', 'two');

    expect(state(container).of('pkg-a').map((s) => s.id), ['two', 'one']);
    expect(store(container).resolve('pkg-a', () => 'unused'), 'two');
  });

  test('starting the same conversation twice does not duplicate it', () {
    final container = make();
    store(container).startNew('pkg-a', 'one');
    store(container).startNew('pkg-a', 'two');
    store(container).startNew('pkg-a', 'one');

    expect(state(container).of('pkg-a').map((s) => s.id), ['one', 'two']);
  });

  test('selecting a conversation the goapp does not keep changes nothing', () {
    final container = make();
    store(container).startNew('pkg-a', 'one');
    store(container).select('pkg-a', 'other');

    expect(state(container).currentOf('pkg-a'), 'one');
  });

  test('forgetting the default falls back to the newest one left', () {
    final container = make();
    store(container).startNew('pkg-a', 'one');
    store(container).startNew('pkg-a', 'two');
    store(container).forget('pkg-a', 'two');

    expect(state(container).of('pkg-a').map((s) => s.id), ['one']);
    expect(state(container).currentOf('pkg-a'), 'one');
  });

  test('forgetting the last conversation leaves no default to resume', () {
    final container = make();
    store(container).startNew('pkg-a', 'one');
    store(container).forget('pkg-a', 'one');

    expect(state(container).of('pkg-a'), isEmpty);
    expect(state(container).currentOf('pkg-a'), isNull);
    // The next open starts over rather than resuming something deleted.
    expect(store(container).resolve('pkg-a', () => 'fresh'), 'fresh');
  });

  test('forgetting a conversation the goapp does not keep is a no-op', () {
    final container = make();
    store(container).startNew('pkg-a', 'one');
    store(container).forget('pkg-a', 'ghost');

    expect(state(container).of('pkg-a').map((s) => s.id), ['one']);
  });

  test('only the newest $goappSessionLimit conversations survive', () {
    final container = make();
    for (var i = 0; i < goappSessionLimit + 5; i++) {
      store(container).startNew('pkg-a', 's$i');
    }

    final ids = state(container).of('pkg-a').map((s) => s.id).toList();
    expect(ids.length, goappSessionLimit);
    expect(ids.first, 's${goappSessionLimit + 4}');
    expect(ids.contains('s0'), isFalse);
  });

  test('conversations and the default come back after a restart', () async {
    final first = make();
    store(first).startNew('pkg-a', 'one');
    store(first).startNew('pkg-a', 'two');
    store(first).select('pkg-a', 'one');
    // The write is debounced; wait for it before the second "launch".
    await Future<void>.delayed(const Duration(milliseconds: 700));

    final saved = (await SharedPreferences.getInstance()).getString(GoappSessions.preferenceKey);
    expect(saved, isNotNull);

    final second = make();
    store(second);
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(state(second).of('pkg-a').map((s) => s.id), ['two', 'one']);
    expect(state(second).currentOf('pkg-a'), 'one');
  });

  test('an unreadable saved value starts empty instead of throwing', () async {
    SharedPreferences.setMockInitialValues({GoappSessions.preferenceKey: 'not json'});
    final container = make();
    store(container);
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(state(container).sessions, isEmpty);
  });
}
