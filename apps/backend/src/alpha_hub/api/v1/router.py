from fastapi import APIRouter

from ...analytics.router import router as analytics_router
from ...auth.router import router as auth_router
from ...azure_db.router import router as azure_db_router
from ...dashboard.router import router as dashboard_router
from ...subscriptions.router import router as subscriptions_router
from ...tenants.router import router as tenants_router
from ...users.router import router as users_router

api_v1_router = APIRouter()
api_v1_router.include_router(auth_router)
api_v1_router.include_router(tenants_router)
api_v1_router.include_router(users_router)
api_v1_router.include_router(azure_db_router)
api_v1_router.include_router(analytics_router)
api_v1_router.include_router(subscriptions_router)
api_v1_router.include_router(dashboard_router)
