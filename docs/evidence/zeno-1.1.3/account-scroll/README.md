# Personal web scrolling hotfix

The standalone PWA imported desktop CSS that fixes html/body/root to the viewport and disables document scrolling. Its personal shell only declared a minimum height, so long account content expanded the shell beyond the clipped root and never gave the inner scroll area a height limit.

The standalone shell now uses `h-dvh`. The embedded desktop branch remains `h-full`. No global overflow setting, account API, database, invitation permission or desktop installer was changed.

- `local-before/report.json`: original production index e407b1…; real mouse-wheel and touch gestures reproduce the failure at 1440×1000 and 390×844.
- `local-after/report.json`: fixed production index b3d17a…; nine behavioral checks pass with a private real API, 21 synthetic accounts and 44 invitations. Mouse-wheel and touch scrolling reach the invitation form and list bottom; a real button click reaches browser validation without creating an invitation. Other personal navigation, error/offline states and the mobile bottom navigation are checked.
- Four before and twelve after screenshots are bound to their original byte hashes. An independent collaborating agent actually opened all sixteen images and reviewed readability and reachability.
- Passwords and fixture-control tokens are randomly generated in private process environment only. No live account, model call or real invitation is used. Local behavior is not represented as authenticated public or native desktop acceptance.

Design rules: P5 (reuse existing controls), P10 (real viewport screenshots). The fix adds no explanatory copy or new product UI.

The PWA deployment and public byte verification are recorded separately after publication. The immutable 1.1.3 desktop tag and packages retain their original product commit.
