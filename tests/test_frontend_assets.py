"""Prevent mixed cached modules after a frontend update."""

import re
from urllib.parse import urljoin

from app.main import ASSET_PREFIX


def test_html_is_fresh_and_entire_module_graph_uses_versioned_urls(client):
    html = client.get("/")
    assert html.status_code == 200
    assert html.headers["cache-control"] == "no-store"
    assert client.get("/index.html").text == html.text
    assert 'type="date"' not in html.text
    assert '<select id="chart-date"' in html.text
    css = re.search(r'href="([^"]+\.css)"', html.text)[1]
    entry = re.search(r'type="module" src="([^"]+)"', html.text)[1]
    assert css.startswith(ASSET_PREFIX + "/")
    assert entry.startswith(ASSET_PREFIX + "/")
    assert ".focus-chart-svg" in client.get(css).text

    visited, pending = set(), [entry]
    while pending:
        url = pending.pop()
        if url in visited:
            continue
        visited.add(url)
        assert url.startswith(ASSET_PREFIX + "/js/")
        response = client.get(url)
        assert response.status_code == 200, url
        assert "javascript" in response.headers["content-type"]
        assert response.headers["cache-control"] == "no-cache"
        pending.extend(
            urljoin(url, specifier)
            for specifier in re.findall(r'from\s+["\']([^"\']+)["\']', response.text)
        )
    assert f"{ASSET_PREFIX}/js/focus-chart.js" in visited
    assert f"{ASSET_PREFIX}/js/api.js" in visited


def test_legacy_assets_and_conditional_responses_require_revalidation(client):
    for path in ["/js/app.js", "/css/style.css", "/notification-worker.js"]:
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-cache"
        cached = client.get(path, headers={"If-None-Match": response.headers["etag"]})
        assert cached.status_code == 304
        assert cached.headers["cache-control"] == "no-cache"
