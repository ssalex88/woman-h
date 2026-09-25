"""HU-02: relatos y precisión de la fecha del hecho."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("record_id", sa.String(36), sa.ForeignKey("private_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("date_kind", sa.String(20), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("approximate_date", sa.String(200), nullable=True),
        sa.Column("place", sa.String(500), nullable=True),
        sa.Column("mentioned_people", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(date_kind = 'exact' AND event_date IS NOT NULL AND approximate_date IS NULL) OR "
            "(date_kind = 'approximate' AND event_date IS NULL AND approximate_date IS NOT NULL) OR "
            "(date_kind = 'unknown' AND event_date IS NULL AND approximate_date IS NULL)", name="account_date_consistency"))
    op.create_index("ix_accounts_record_id", "accounts", ["record_id"])


def downgrade():
    op.drop_table("accounts")
