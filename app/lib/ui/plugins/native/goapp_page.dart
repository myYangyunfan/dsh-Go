// A goapp opened from outside the app: `dshgo://open/panel/<package>/<id>`.
//
// A goapp is a plugin with its own panel (plugins/goapp/SPEC.md), so a launcher
// shortcut only has to name that panel. This page resolves it through the same
// registry the native plugin pages use and shows it full screen — which is what
// lets a shortcut skip the home screen.
//
// The package may be scoped (`@scope/name`), so everything between `panel` and
// the last segment is the package; the last segment is the panel id.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/l10n.dart';
import '../../../plugins/native/native_model.dart';
import '../../../plugins/native/native_state.dart';
import '../../shell/page_frame.dart';
import 'native_panel.dart';

/// The page a `dshgo://open/panel/…` link opens.
class GoappPanelPage extends ConsumerWidget {
  const GoappPanelPage({super.key, required this.package, required this.id, this.sessionId});

  final String package;
  final String id;
  final String? sessionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final panel = _panel(ref.watch(nativePanelsProvider));
    if (panel != null) return NativePanelPage(panel: panel, sessionId: sessionId);
    // Switched off, removed, or not loaded yet: name the panel that is missing
    // and stay a page, so the back arrow returns to the home screen.
    return AppPage.list(
      title: package,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          child: Text(context.l10n.plugslotsIssueUnknownPage('panel:$package/$id')),
        ),
      ],
    );
  }

  NativePanel? _panel(List<NativePanel> panels) =>
      panels.where((p) => p.package == package && p.id == id).firstOrNull;
}
