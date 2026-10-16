/** Change only presentation; keep storage keys, application ids and links intact. */
export function applyZenoDocumentIdentity(document: Document, faviconUrl: string): () => void {
  const root = document.documentElement;
  const previousAttribute = root.getAttribute("data-zeno-interface");
  const previousTitle = document.title;
  const originals = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
  const anchors = originals.map((link) => {
    const anchor = document.createComment("original product icon");
    link.replaceWith(anchor);
    return { link, anchor };
  });
  const favicon = document.createElement("link");
  favicon.rel = "icon";
  favicon.type = "image/x-icon";
  favicon.href = faviconUrl;
  document.head.append(favicon);

  const metadata = Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"], meta[name="apple-mobile-web-app-title"]'))
    .map((element) => ({ element, content: element.getAttribute("content") }));
  for (const { element } of metadata) {
    element.content = element.name === "apple-mobile-web-app-title"
      ? "泽诺 Zeno"
      : element.getAttribute("media")?.includes("dark") ? "#142b2b" : "#f3f1e8";
  }
  root.dataset.zenoInterface = "true";
  document.title = "泽诺 Zeno";

  return () => {
    if (previousAttribute === null) root.removeAttribute("data-zeno-interface");
    else root.setAttribute("data-zeno-interface", previousAttribute);
    document.title = previousTitle;
    favicon.remove();
    for (const { link, anchor } of anchors) anchor.replaceWith(link);
    for (const { element, content } of metadata) {
      if (content === null) element.removeAttribute("content");
      else element.setAttribute("content", content);
    }
  };
}
