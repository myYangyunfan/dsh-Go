// A goapp opened from outside the app (a launcher shortcut, a
// `dshgo://open/panel/…` link) runs in a conversation of its own, and its page
// carries that goapp's conversations: start another, go back to one, drop one.
//
// The Host never learns these scope ids (see `goapp_sessions.dart`), so what is
// checked here is what the App sends: the panel is read again under the new
// session, and the old conversation stops being read at all.

import 'package:dsh_app/ui/plugins/native/goapp_page.dart';
import 'package:dsh_app/ui/theme/app_icons.dart';
import 'package:dsh_client/dsh_client.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../chat/support/harness.dart';
import 'support.dart';

const _pkg = 'goapp-demo-word';

FakeBridge goappBridge() {
  final bridge = FakeBridge(
    contributions([
      plugin(
        _pkg,
        title: '背单词',
        icon: 'school',
        panels: [
          {
            'id': 'word',
            'title': '背单词',
            'placement': ['goapp', 'features'],
          },
        ],
      ),
    ]),
  );
  bridge.views['$_pkg/word'] = const DshGoView(
    pkg: _pkg,
    id: 'word',
    title: '背单词',
    view: {'type': 'text', 'text': 'apple'},
    data: {'word': 'apple'},
    rev: 'r1',
    live: true,
    bytes: 120,
  );
  return bridge;
}

/// Every session the panel was read under, oldest first.
List<String> scopes(FakeBridge bridge) => [
  for (final frame in bridge.socket.sent)
    if (frame['t'] == 'sub' && frame['id'] == 'word') (frame['scope'] as Map?)?['sessionId'] as String? ?? '',
];

void main() {
  setUpAll(loadTestFonts);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('a goapp opened from a shortcut runs in its own conversation', (tester) async {
    usePhoneView(tester);
    final bridge = goappBridge();
    await tester.pumpWidget(
      testApp(
        const GoappPanelPage(package: _pkg, id: 'word'),
        overrides: nativeOverrides(bridge),
      ),
    );
    await pumpFrames(tester);

    expect(find.text('apple'), findsOneWidget);
    final first = scopes(bridge).single;
    expect(first, startsWith('goapp-'), reason: 'resolved for this goapp, not inherited from the chat tab');
  });

  testWidgets('a new conversation reads the panel again under a new session', (tester) async {
    usePhoneView(tester);
    final bridge = goappBridge();
    await tester.pumpWidget(
      testApp(
        const GoappPanelPage(package: _pkg, id: 'word'),
        overrides: nativeOverrides(bridge),
      ),
    );
    await pumpFrames(tester);
    final first = scopes(bridge).single;

    await tester.tap(find.byIcon(AppIcons.history));
    await pumpFrames(tester);
    await tester.tap(find.byKey(const ValueKey('goapp-conversation-new')));
    await pumpFrames(tester);

    final all = scopes(bridge);
    expect(all.length, greaterThan(1), reason: 'the new conversation is read from the plugin');
    expect(all.last, isNot(first));
    expect(all.last, startsWith('goapp-'));
    expect(find.text('apple'), findsOneWidget, reason: 'the panel is still there');
  });

  testWidgets('dropping the conversation on screen falls back to the one left', (tester) async {
    usePhoneView(tester);
    final bridge = goappBridge();
    await tester.pumpWidget(
      testApp(
        const GoappPanelPage(package: _pkg, id: 'word'),
        overrides: nativeOverrides(bridge),
      ),
    );
    await pumpFrames(tester);
    final first = scopes(bridge).single;

    // A second conversation, then drop it: the goapp goes back to the first.
    await tester.tap(find.byIcon(AppIcons.history));
    await pumpFrames(tester);
    await tester.tap(find.byKey(const ValueKey('goapp-conversation-new')));
    await pumpFrames(tester);
    final second = scopes(bridge).last;
    expect(second, isNot(first));

    await tester.tap(find.byIcon(AppIcons.history));
    await pumpFrames(tester);
    // Newest first: the row on top is the conversation being shown.
    await tester.tap(find.byIcon(AppIcons.delete).first);
    await pumpFrames(tester);

    expect(scopes(bridge).last, first, reason: 'the conversation that was left is read again');
  });
}
