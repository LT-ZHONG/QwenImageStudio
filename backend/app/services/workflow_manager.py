"""Loads the ComfyUI API workflow template and builds per-task copies."""
import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class WorkflowError(Exception):
    pass


@dataclass(frozen=True)
class ParamLimits:
    default: Any = None
    min: float | None = None
    max: float | None = None
    step: float | None = None


class WorkflowManager:
    def __init__(self, mapping_file: Path):
        self.mapping_file = Path(mapping_file)
        self.mapping: dict = json.loads(self.mapping_file.read_text(encoding="utf-8"))
        wf_path = (self.mapping_file.parent / self.mapping["workflow_file"]).resolve()
        self._template: dict = json.loads(wf_path.read_text(encoding="utf-8"))
        self.model: str = self.mapping["model"]
        self._validate_template()

    # ---- mapping helpers -------------------------------------------------
    def node_id(self, alias: str) -> str:
        return self.mapping["nodes"][alias]["id"]

    @property
    def save_node_id(self) -> str:
        return self.node_id("save_image")

    def limits(self, param: str) -> ParamLimits:
        spec = self.mapping["params"][param]
        return ParamLimits(spec.get("default"), spec.get("min"), spec.get("max"), spec.get("step"))

    def model_files(self) -> dict[str, str]:
        """Read-only view of model files configured in the workflow."""
        t = self._template
        return {
            "unet": t[self.node_id("unet")]["inputs"]["unet_name"],
            "clip": t[self.node_id("clip")]["inputs"]["clip_name"],
            "vae": t[self.node_id("vae")]["inputs"]["vae_name"],
        }

    # ---- validation ------------------------------------------------------
    def _validate_template(self) -> None:
        for alias, spec in self.mapping["nodes"].items():
            node = self._template.get(spec["id"])
            if node is None:
                raise WorkflowError(f"Workflow 缺少节点 {spec['id']} ({alias})")
            if node["class_type"] != spec["class_type"]:
                raise WorkflowError(
                    f"节点 {spec['id']} 类型应为 {spec['class_type']}，实际为 {node['class_type']}"
                )
        for name, spec in self.mapping["params"].items():
            node = self._template[self.node_id(spec["node"])]
            if spec["input"] not in node["inputs"]:
                raise WorkflowError(f"节点 {spec['node']} 没有输入 {spec['input']} (参数 {name})")

    # ---- build -----------------------------------------------------------
    def build(
        self,
        *,
        comfy_image: str,
        prompt: str,
        negative_prompt: str,
        seed: int,
        steps: int,
        cfg: float,
        denoise: float,
        resolution: int,
    ) -> dict:
        wf = copy.deepcopy(self._template)  # never mutate the template
        values = {
            "image": comfy_image,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "seed": seed,
            "steps": steps,
            "cfg": cfg,
            "denoise": denoise,
            "resolution": resolution,
        }
        for name, value in values.items():
            spec = self.mapping["params"][name]
            wf[self.node_id(spec["node"])]["inputs"][spec["input"]] = value
        for fixed in self.mapping.get("fixed_inputs", []):
            wf[self.node_id(fixed["node"])]["inputs"][fixed["input"]] = fixed["value"]
        # strip front-end-only nodes (e.g. ImageCompare holding temp URLs)
        for nid in self.mapping.get("remove_nodes", []):
            wf.pop(nid, None)
        fp = self.mapping["filename_prefix"]
        wf[self.node_id(fp["node"])]["inputs"][fp["input"]] = fp["prefix"]
        return wf
