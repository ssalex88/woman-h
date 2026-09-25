"""HU-04: reintentos de Inicio sin duplicar registros o relatos."""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("start_entries",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("entry_id", sa.String(36), primary_key=True),
        sa.Column("record_id", sa.String(36), sa.ForeignKey("private_records.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, unique=True))


def downgrade():
    op.drop_table("start_entries")
