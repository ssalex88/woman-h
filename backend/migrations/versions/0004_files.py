"""HU-03: metadatos de originales privados y relaciones con relatos."""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("record_files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("record_id", sa.String(36), sa.ForeignKey("private_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("description", sa.String(2000), nullable=True),
        sa.Column("media_type", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("original_key", sa.String(100), nullable=False, unique=True),
        sa.Column("preview_key", sa.String(100), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_record_files_record_id", "record_files", ["record_id"])
    op.create_table("file_accounts",
        sa.Column("file_id", sa.String(36), sa.ForeignKey("record_files.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True))


def downgrade():
    op.drop_table("file_accounts")
    op.drop_table("record_files")
