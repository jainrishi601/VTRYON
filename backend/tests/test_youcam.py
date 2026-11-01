"""U-YC-1..7: the YouCam wrapper against a fake YouCam (httpx.MockTransport). No network."""

import io
import json

import httpx
import pytest
from PIL import Image

from app import config, youcam
from app.db import q, q1
from app.renders import SLOT_CATEGORY
from app.youcam import RenderError, RenderUnavailable, Src

JPEG = io.BytesIO()
Image.new("RGB", (8, 8), "red").save(JPEG, "JPEG")
JPEG = JPEG.getvalue()


class FakeYouCam:
    def __init__(self, polls=("running", "success"), create=None, task_error="error_pose"):
        self.calls: list[httpx.Request] = []
        self.polls = list(polls)
        self.create = list(create or [])  # scripted (status, body) responses for task creation
        self.task_error = task_error
        self.refuse_files: set[str] = set()

    def bodies(self, path_part):
        return [json.loads(r.content) for r in self.calls if r.method == "POST" and path_part in r.url.path]

    def __call__(self, r: httpx.Request) -> httpx.Response:
        self.calls.append(r)
        p = r.url.path
        if r.url.host == "s3.test":
            return httpx.Response(200, content=JPEG)
        if r.method == "POST" and "/task/" in p:
            if self.create:
                code, body = self.create.pop(0)
                return httpx.Response(code, json=body)
            return httpx.Response(200, json={"status": 200, "data": {"task_id": "t1"}})
        if r.method == "GET" and "/task/" in p:
            st = self.polls.pop(0) if len(self.polls) > 1 else self.polls[0]
            data = {"task_status": st}
            if st == "success":
                data["results"] = {"url": "https://s3.test/result.jpg"}
            if st == "error":
                data["error"] = self.task_error
            return httpx.Response(200, json={"status": 200, "data": data})
        if r.method == "POST" and "/file/" in p:
            if p in self.refuse_files:
                return httpx.Response(404, json={"status": 404, "error": "not_found"})
            return httpx.Response(200, json={"status": 200, "data": {"files": [
                {"file_id": "f_123", "requests": [{"url": "https://s3.test/upload", "headers": {"x": "1"}}]}]}})
        if r.method == "PUT":
            return httpx.Response(200)
        return httpx.Response(404, json={"error": "not_found"})


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(config, "RENDER_STUB", False)
    f = FakeYouCam()
    monkeypatch.setattr(youcam, "_transport", httpx.MockTransport(f))
    return f


SRC = Src(key="model:w1", url="https://pub.test/w1.jpg")


@pytest.mark.parametrize("slot", ["top", "bottom", "one_piece", "layer"])
async def test_yc1_body_per_slot(fake, slot):
    await youcam.try_on(SRC, f"https://img.test/{slot}.jpg", SLOT_CATEGORY[slot])
    body = fake.bodies("/task/cloth-v4")[0]
    assert body == {"src_file_url": "https://pub.test/w1.jpg", "ref_file_url": f"https://img.test/{slot}.jpg",
                    "garment_category": SLOT_CATEGORY[slot], "change_shoes": False}
    assert fake.calls[0].headers["authorization"] == "Bearer sk-test"


async def test_yc2_poll_success_downloads(fake):
    res = await youcam.try_on(SRC, "https://img.test/a.jpg", "upper_body")
    assert res.remote_url == "https://s3.test/result.jpg" and not res.cached and res.units == 2
    assert config.media_path(res.url_local).read_bytes() == JPEG
    row = q1("select * from renders where cache_key=?", res.cache_key)
    assert row["status"] == "success" and row["task_id"] == "t1" and row["units"] == 2
    assert "authorization" not in {k.lower() for k in fake.calls[-1].headers if fake.calls[-1].url.host == "s3.test"}


async def test_yc2_poll_error_maps_copy(fake):
    fake.polls = ["running", "error"]
    with pytest.raises(RenderError) as e:
        await youcam.try_on(SRC, "https://img.test/a.jpg", "upper_body")
    assert e.value.code == "error_pose"
    assert e.value.user_message == "Step back so your whole body is visible, facing the camera."
    fake.polls, fake.task_error = ["error"], "something_new"
    with pytest.raises(RenderError) as e:
        await youcam.try_on(SRC, "https://img.test/b.jpg", "upper_body")
    assert e.value.user_message == youcam.GENERIC


async def test_yc3_cache_hit_makes_no_calls(fake):
    a = await youcam.try_on(SRC, "https://img.test/a.jpg", "lower_body")
    n = len(fake.calls)
    b = await youcam.try_on(Src(key="model:w1"), "https://img.test/a.jpg", "lower_body")
    assert len(fake.calls) == n and b.cached and b.units == 0 and b.url_local == a.url_local
    assert q1("select cached_hits from renders where cache_key=?", a.cache_key)["cached_hits"] == 1


async def test_yc4_429_backoff_then_success(fake, monkeypatch):
    slept = []

    async def sleep(s):
        slept.append(s)

    monkeypatch.setattr(youcam.asyncio, "sleep", sleep)
    monkeypatch.setattr(config, "BACKOFF", (2, 4, 8))
    fake.create = [(429, {"error": "rate"}), (429, {"error": "rate"})]
    res = await youcam.try_on(SRC, "https://img.test/a.jpg", "upper_body")
    assert res.remote_url and slept[:2] == [2, 4]
    assert len(fake.bodies("/task/cloth-v4")) == 3


async def test_yc4_credit_insufficiency_flips_demo(fake):
    fake.create = [(400, {"status": 400, "error_code": "CreditInsufficiency"})]
    assert not youcam.demo_mode()
    with pytest.raises(RenderUnavailable):
        await youcam.try_on(SRC, "https://img.test/a.jpg", "upper_body")
    assert youcam.demo_mode()


async def test_yc5_invalid_parameters_retries_with_auto(fake):
    fake.create = [(400, {"status": 400, "error_code": "InvalidParameters"})]
    await youcam.try_on(SRC, "https://img.test/a.jpg", "outer")
    cats = [b["garment_category"] for b in fake.bodies("/task/cloth-v4")]
    assert cats == ["outer", "auto"]


async def test_yc6_demo_mode_uncached_raises_without_calls(fake, monkeypatch):
    monkeypatch.setattr(config, "YOUCAM_DEMO_MODE", True)
    with pytest.raises(RenderUnavailable):
        await youcam.try_on(SRC, "https://img.test/a.jpg", "upper_body")
    assert fake.calls == []


async def test_yc6_demo_mode_serves_cache(fake, monkeypatch):
    await youcam.try_on(SRC, "https://img.test/a.jpg", "upper_body")
    monkeypatch.setattr(config, "YOUCAM_DEMO_MODE", True)
    assert (await youcam.try_on(SRC, "https://img.test/a.jpg", "upper_body")).cached


async def test_yc7_image_to_video(fake):
    url = await youcam.image_to_video("https://s3.test/look.jpg", "walk", src_key="k1")
    body = fake.bodies("/task/image-to-video/youcam")[0]
    assert body == {"src_file_url": "https://s3.test/look.jpg", "resolution": "480", "dst_duration": 5, "prompt": "walk"}
    assert any(r.method == "GET" and r.url.path == "/s2s/v2.0/task/image-to-video/youcam/t1" for r in fake.calls)
    assert config.media_path(url).exists() and q1("select units from renders where garment_category='video'")["units"] == 5


async def test_upload_once_per_source(fake, env):
    photo = env / "me.jpg"
    Image.new("RGB", (600, 900)).save(photo)
    await youcam.try_on(Src(key="photo:abc", path=photo), "https://img.test/a.jpg", "upper_body")
    await youcam.try_on(Src(key="photo:abc", path=photo), "https://img.test/b.jpg", "upper_body")
    assert len([r for r in fake.calls if r.url.path.endswith("/file/cloth")]) == 1
    assert [b["src_file_id"] for b in fake.bodies("/task/cloth-v4")] == ["f_123", "f_123"]
    put = next(r for r in fake.calls if r.method == "PUT")
    assert "authorization" not in put.headers and put.headers["x"] == "1"


async def test_session_cap(fake, monkeypatch):
    monkeypatch.setattr(config, "SESSION_RENDER_CAP", 1)
    await youcam.try_on(SRC, "https://img.test/a.jpg", "upper_body", session_id="s1")
    with pytest.raises(RenderError) as e:
        await youcam.try_on(SRC, "https://img.test/b.jpg", "upper_body", session_id="s1")
    assert e.value.code == "session_cap" and len(q("select * from renders")) == 1


@pytest.mark.parametrize("refuse", [False, True])
async def test_yc7_video_from_stale_render_uploads_local_copy(fake, env, refuse):
    """Render older than 2 h, no PUBLIC_BASE_URL: upload our copy once, send src_file_id."""
    if refuse:
        fake.refuse_files.add("/s2s/v2.0/file/image-to-video")
    local = env / "render.jpg"
    Image.new("RGB", (600, 900)).save(local)
    src = Src(key="renderkey1", path=local)  # what result_src returns when the YouCam URL is stale
    await youcam.image_to_video(src, "walk")
    await youcam.image_to_video(src, "turn")
    files = [r.url.path for r in fake.calls if "/file/" in r.url.path]
    want = ["/s2s/v2.0/file/image-to-video"] + (["/s2s/v2.0/file/cloth"] if refuse else [])
    assert files == want  # second clip reuses the cached file_id
    bodies = fake.bodies("/task/image-to-video/youcam")
    assert [b.get("src_file_id") for b in bodies] == ["f_123", "f_123"] and "src_file_url" not in bodies[0]
    assert q1("select file_id from uploads where src_key='image-to-video:renderkey1'")["file_id"] == "f_123"


async def test_video_uses_result_src_when_stale(fake, env, monkeypatch):
    from app import looks
    from app.db import ex
    ex("insert into renders(cache_key, status, result_url, local_path, created_at) values "
       "('rk', 'success', 'https://s3.test/old.jpg', '/media/renders/rk.jpg', '2026-01-01T00:00:00.000+00:00')")
    config.media_path("/media/renders/rk.jpg").write_bytes(JPEG)
    await looks._video({"id": "lk_x", "render_key": "rk", "render_url": "/media/renders/rk.jpg"})
    assert fake.bodies("/task/image-to-video/youcam")[0]["src_file_id"] == "f_123"
