"""
Azure DB router: manage per-tenant Azure SQL connection configuration.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.platform import get_platform_session
from ..dependencies import require_admin
from ..models.platform import User
from . import service
from .schemas import AzureDbConfigCreate, AzureDbConfigResponse, AzureDbTestResult

router = APIRouter(prefix="/azure-db", tags=["azure-db"])


async def _get_db() -> AsyncSession:  # type: ignore[return]
    async with get_platform_session() as session:
        yield session  # type: ignore[misc]


@router.get("/{tenant_id}", response_model=AzureDbConfigResponse)
async def get_config(
    tenant_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> AzureDbConfigResponse:
    """Get the Azure SQL config for a tenant (admin only)."""
    config = await service.get_db_config(session, tenant_id)
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No database configuration for this tenant",
        )
    return AzureDbConfigResponse(
        id=str(config.id),
        tenant_id=str(config.tenant_id),
        host=config.host,
        database_name=config.database_name,
        db_username=config.db_username,
        status=config.status,
        last_tested_at=config.last_tested_at,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


@router.post("/{tenant_id}", response_model=AzureDbConfigResponse)
async def save_config(
    tenant_id: str,
    data: AzureDbConfigCreate,
    request: Request,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> AzureDbConfigResponse:
    """Create or update the Azure SQL config for a tenant (admin only)."""
    tenant_registry = getattr(request.app.state, "tenant_registry", None)
    return await service.save_db_config(
        session, tenant_id, data, tenant_registry=tenant_registry
    )


@router.post("/{tenant_id}/test", response_model=AzureDbTestResult)
async def test_config(
    tenant_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> AzureDbTestResult:
    """
    Test the Azure SQL connection for a tenant.
    Returns success + latency or an error message.
    Requires aioodbc and ODBC Driver 18 for SQL Server on the server.
    """
    return await service.test_db_connection(session, tenant_id)


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(
    tenant_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> None:
    """Delete the Azure SQL config for a tenant (admin only)."""
    found = await service.delete_db_config(session, tenant_id)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No database configuration for this tenant",
        )
