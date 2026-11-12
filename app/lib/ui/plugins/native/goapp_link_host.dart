// `dshgo://open/panel/<package>/<id>`: a goapp opened from outside the app.
//
// Registered from inside the home route, next to [LinkHost] and [ShareCodeHost],
// because opening a panel means pushing a page and pages are built here — the
// links layer that parses the URL (links/page_links.dart) must not import ui/.
//
// The router picks the longest handler key, so `open/panel` wins over the `open`
// page links and a multi-segment panel link never reaches them.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../links/app_links.dart';
import '../../../links/page_links.dart' show pageLinkHost, panelLinkPage, panelLinkTarget;
import 'goapp_page.dart';

/// Draws nothing; registers the panel link host with the router.
class GoappLinkHost extends ConsumerStatefulWidget {
  const GoappLinkHost({super.key});

  @override
  ConsumerState<GoappLinkHost> createState() => _GoappLinkHostState();
}

class _GoappLinkHostState extends ConsumerState<GoappLinkHost> {
  late final VoidCallback _off;

  @override
  void initState() {
    super.initState();
    _off = ref.read(linkRouterProvider).registerLinkHandler('$pageLinkHost/$panelLinkPage', _open);
  }

  @override
  void dispose() {
    _off();
    super.dispose();
  }

  /// Always true: a panel link is ours even when the panel is missing — the page
  /// then says which one, instead of the router's 「无法打开这个链接」.
  Future<bool> _open(Uri uri) async {
    final target = panelLinkTarget(uri);
    if (target == null) return false;
    final context = ref.read(linkRouterProvider).context;
    if (context == null || !context.mounted) return false;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => GoappPanelPage(package: target.package, id: target.id)),
    );
    return true;
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
