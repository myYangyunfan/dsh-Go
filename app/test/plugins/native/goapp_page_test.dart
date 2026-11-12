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
///
/// One socket per read (the bridge hands a fresh stream to each surface), so the
/// frames have to be collected across all of them — the newest socket holds only
/// the newest read.
List<String> scopes(FakeBridge bridge) => [
  for (final socket in bridge.sockets)
    for (final frame in socket.sent)
      if (frame['t'] == 'sub' && frame['id'] == 'word') (frame['scope'] as Map?)?['sessionId'] as String? ?? '',
];

/// Opens the goapp over a phone-width window and lets it settle.
Future<void> openGoapp(WidgetTester tester, FakeBridge bridge) async {
  usePhoneView(tester);
  await tester.pumpWidget(
    testApp(
      const GoappPanelPage(package: _pkg, id: 'word'),
      overrides: nativeOverrides(bridge),
    ),
  );
  await pumpFrames(tester);
}

/// Long enough for a sheet to finish rising (or falling) before a tap lands.
Future<void> pumpSheet(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 400));
  await pumpFrames(tester);
}

Future<void> openConversations(WidgetTester tester) async {
  await tester.tap(find.byIcon(AppIcons.history));
  await pumpSheet(tester);
}

void main() {
  setUpAll(loadTestFonts);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('a goapp opened from a shortcut runs in its own conversation', (tester) async {
    final bridge = goappBridge();
    await openGoapp(tester, bridge);

    expect(find.text('apple'), findsOneWidget);
    final first = scopes(bridge).single;
    expect(first, startsWith('goapp-'), reason: 'resolved for this goapp, not inherited from the chat tab');
  });

  testWidgets('a new conversation reads the panel again under a new session', (tester) async {
    final bridge = goappBridge();
    await openGoapp(tester, bridge);
    final first = scopes(bridge).single;

    await openConversations(tester);
    await tester.tap(find.byKey(const ValueKey('goapp-conversation-new')));
    await pumpSheet(tester);

    final all = scopes(bridge);
    expect(all.length, greaterThan(1), reason: 'the new conversation is read from the plugin');
    expect(all.last, isNot(first));
    expect(all.last, startsWith('goapp-'));
    expect(find.text('apple'), findsOneWidget, reason: 'the panel is still there');
  });

  testWidgets('dropping the conversation on screen falls back to the one left', (tester) async {
    final bridge = goappBridge();
    await openGoapp(tester, bridge);
    final first = scopes(bridge).single;

    // A second conversation, then drop it: the goapp goes back to the first.
    await openConversations(tester);
    await tester.tap(find.byKey(const ValueKey('goapp-conversation-new')));
    await pumpSheet(tester);
    final second = scopes(bridge).last;
    expect(second, isNot(first));

    await openConversations(tester);
    // Newest first: the row on top is the conversation being shown.
    await tester.tap(find.byIcon(AppIcons.delete).first);
    await pumpSheet(tester);

    expect(scopes(bridge).last, first, reason: 'the conversation that was left is read again');
  });
}
