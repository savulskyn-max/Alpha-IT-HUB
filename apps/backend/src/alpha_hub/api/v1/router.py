from fastapi import APIRouter

from ...auth.router import router as auth_router
from ...tenants.router import router as tenants_router

api_v1_router = APIRouter()
api_v1_router.include_router(auth_router)
api_v1_router.include_router(tenants_router)
