from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.models import AppSetting
from app.schemas import SettingsOut, SettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])
KEY = "preferences"


async def _load(s: AsyncSession) -> SettingsOut:
    row = await s.get(AppSetting, KEY)
    if row is None or not isinstance(row.value, dict):
        return SettingsOut()
    try:
        return SettingsOut.model_validate(row.value)
    except ValueError:  # stored values no longer satisfy the current limits
        return SettingsOut()


@router.get("", response_model=SettingsOut)
async def get_settings(s: AsyncSession = Depends(get_session)) -> SettingsOut:
    return await _load(s)


@router.put("", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, s: AsyncSession = Depends(get_session)) -> SettingsOut:
    current = await _load(s)
    merged = current.model_copy(update=body.model_dump(exclude_none=True, exclude={"default_params"}))
    if body.default_params is not None:
        merged.default_params = body.default_params
    value = merged.model_dump(mode="json")
    row = await s.get(AppSetting, KEY)
    if row is None:
        s.add(AppSetting(key=KEY, value=value))
    else:
        row.value = value
    await s.commit()
    return merged
