"""HU-07: propuesta y revisión privada, separadas de las fuentes originales."""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("timelines",
        sa.Column("record_id", sa.String(36), sa.ForeignKey("private_records.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("confirmed_revision", sa.Integer(), nullable=True),
        sa.Column("mode", sa.String(30), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("timelines")
