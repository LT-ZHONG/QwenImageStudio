import copy
import json

import pytest

from app.config import BACKEND_DIR
from app.services.comfyui_client import ComfyUIClient
from app.services.storage import Storage, StorageError
from app.services.workflow_manager import WorkflowManager

KW = dict(
    comfy_image="a.png", prompt="p", negative_prompt="n", seed=7, steps=20, cfg=1.0, denoise=0.9, resolution=768
)


@pytest.fixture
def wm():
    return WorkflowManager(BACKEND_DIR / "workflow_mapping.json")


def test_build_injects_params_and_leaves_template_untouched(wm):
    before = copy.deepcopy(wm._template)
    wf = wm.build(**KW)
    assert wf["470"]["inputs"]["image"] == "a.png"
    assert wf["486"]["inputs"]["prompt"] == "p" and wf["486"]["inputs"]["resolution"] == 768
    assert wf["483"]["inputs"]["seed"] == 7 and wf["483"]["inputs"]["denoise"] == 0.9
    assert wf["484"]["inputs"]["switch"] is False
    assert wf["461"]["inputs"]["filename_prefix"] == "QwenStudio"
    assert "472" not in wf  # ImageCompare (temp URLs) is stripped
    assert wm._template == before
    assert wm.build(**KW) is not wf


def test_models_come_from_workflow(wm):
    assert wm.model_files()["unet"] == "qwen_image_2.1_int8_convrot.safetensors"


def test_workflow_validation_detects_wrong_node_type(tmp_path):
    mapping = json.loads((BACKEND_DIR / "workflow_mapping.json").read_text())
    wf = json.loads((BACKEND_DIR / "workflows/Qwen_i2i_api.json").read_text())
    wf["483"]["class_type"] = "Other"
    (tmp_path / "wf.json").write_text(json.dumps(wf))
    mapping["workflow_file"] = "wf.json"
    (tmp_path / "m.json").write_text(json.dumps(mapping))
    with pytest.raises(Exception, match="483"):
        WorkflowManager(tmp_path / "m.json")


def test_storage_rejects_path_traversal(tmp_path):
    st = Storage(tmp_path)
    with pytest.raises(StorageError):
        st.resolve("../etc/passwd")
    with pytest.raises(StorageError):
        st.resolve("/etc/passwd")
    assert st.resolve("input/a.png").is_relative_to(tmp_path.resolve())


@pytest.mark.parametrize(
    "entry,status",
    [
        ({"status": {"status_str": "success", "completed": True, "messages": []}, "outputs": {"1": {}}}, "success"),
        ({"status": {"status_str": "error", "completed": False, "messages": [["execution_interrupted", {}]]}}, "interrupted"),
        ({"status": {"status_str": "error", "messages": [["execution_error", {"exception_message": "boom"}]]}}, "error"),
        ({"status": {"status_str": "running", "completed": False, "messages": []}}, None),
    ],
)
def test_parse_history(entry, status):
    r = ComfyUIClient._parse_history(entry)
    assert (r.status if r else None) == status
