"""U-RND-1..4: render plan, chaining, swap mode, mid-chain failure."""

import asyncio

import pytest

from app import catalog, looks, renders, sessions, youcam
from app.db import ex
from app.youcam import RenderError, TryOnResult

pytestmark = pytest.mark.usefixtures("fx_catalog")


def items(*pids):
    return [{"slot": catalog.get(p)["slot"], "product": catalog.get(p)} for p in pids]


def test_rnd1_plan():
    assert [s["category"] for s in renders.plan(items("wo0"))] == ["full_body"]
    assert [s["category"] for s in renders.plan(items("wt1", "wb1"))] == ["lower_body", "upper_body"]
    assert [s["category"] for s in renders.plan(items("wt1", "wb1", "wl1"))] == ["lower_body", "upper_body", "outer"]
    assert [s["category"] for s in renders.plan(items("wo0", "wl1", "ub1"))] == ["full_body", "outer"]


class FakeTryOn:
    def __init__(self, fail_at=None):
        self.calls, self.fail_at = [], fail_at

    async def __call__(self, src, ref_url, category, change_shoes=False, session_id=None):
        self.calls.append((src, ref_url, category))
        if self.fail_at == len(self.calls):
            raise RenderError("error_pose")
        key = youcam.cache_key(src.key, ref_url, category, change_shoes)
        return TryOnResult(f"/media/renders/{key}.jpg", f"https://s3.test/{key}.jpg", key, False, 2, 10)


@pytest.fixture
def fake(monkeypatch):
    f = FakeTryOn()
    monkeypatch.setattr(youcam, "try_on", f)
    return f


async def test_rnd2_chain_passes_previous_result(fake):
    src = youcam.Src(key="model:w1")
    steps = renders.plan(items("wt1", "wb1"))
    res, cached = await renders.run(steps, src)
    (s1, ref1, _), (s2, ref2, _) = fake.calls
    assert s1.key == "model:w1" and ref1.endswith("wb1_vto.jpg") and ref2.endswith("wt1_vto.jpg")
    k1 = youcam.cache_key("model:w1", ref1, "lower_body")
    assert s2.key == k1 and s2.url == f"https://s3.test/{k1}.jpg"
    assert res.cache_key == youcam.cache_key(k1, ref2, "upper_body") and not cached
    assert renders.planned_keys(steps, "model:w1") == [k1, res.cache_key]


def session_with_photo():
    s, _, _ = sessions.create()
    url, key = sessions.model_photo("w1")
    ex("update sessions set photo_url=?, src_url=? where id=?", url, key, s["id"])
    return s["id"]


async def settle(look_id):
    async for _ in looks.wait_settled([look_id], timeout=5):
        pass
    return looks.look_json(look_id)


async def test_rnd3_swap_bottom_is_one_call_on_parent_render(fake):
    sid = session_with_photo()
    lk = looks.create_look(sid, "Sunset Linen", "why", [("top", "wt1"), ("bottom", "wb1")])
    looks.start_render(lk["id"])
    parent = await settle(lk["id"])
    assert parent["render"]["status"] == "ready" and len(fake.calls) == 2
    child = looks.swap(lk["id"], "bottom", "wb2")
    child = await settle(child["id"])
    assert len(fake.calls) == 3 and child["parent_look_id"] == lk["id"]
    src, ref, cat = fake.calls[-1]
    assert cat == "lower_body" and ref.endswith("wb2_vto.jpg") and src.key == renders.planned_keys(
        renders.plan(items("wt1", "wb1")), "model:w1")[-1]
    assert child["render"]["status"] == "ready" and child["render"]["steps_total"] == 1
    assert {it["product"]["id"] for it in child["items"]} == {"wt1", "wb2"}


async def test_rnd3_swap_one_piece_replans(fake):
    sid = session_with_photo()
    lk = looks.create_look(sid, "A", "", [("top", "wt1"), ("bottom", "wb1")])
    looks.start_render(lk["id"])
    await settle(lk["id"])
    child = await settle(looks.swap(lk["id"], "one_piece", "wo1")["id"])
    assert [it["slot"] for it in child["items"]] == ["one_piece"]
    assert fake.calls[-1][0].key == "model:w1" and fake.calls[-1][2] == "full_body"


async def test_rnd4_failure_mid_chain(monkeypatch):
    f = FakeTryOn(fail_at=2)
    monkeypatch.setattr(youcam, "try_on", f)
    sid = session_with_photo()
    lk = looks.create_look(sid, "A", "", [("top", "wt1"), ("bottom", "wb1")])
    looks.start_render(lk["id"])
    out = await settle(lk["id"])
    assert out["render"]["status"] == "failed" and out["render"]["image_url"] is None
    assert out["render"]["error"] == "Step back so your whole body is visible, facing the camera."
    assert out["render"]["steps_done"] == 1


async def test_no_photo_and_minor_copy(fake):
    s, _, _ = sessions.create()
    lk = looks.create_look(s["id"], "A", "", [("one_piece", "wo0")])
    looks.start_render(lk["id"])
    assert looks.look_json(lk["id"])["render"]["error"] == looks.NO_PHOTO
    sid = session_with_photo()
    ex("update sessions set brief=? where id=?", {"for": "other", "recipient": {"age_range": "13-17"}}, sid)
    lk = looks.create_look(sid, "A", "", [("one_piece", "wo0")])
    looks.start_render(lk["id"])
    assert looks.look_json(lk["id"])["render"]["status"] == "failed" and fake.calls == []
    await asyncio.sleep(0)
