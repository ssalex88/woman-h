from io import BytesIO
from pathlib import PurePosixPath
import threading
import unicodedata
import warnings
from fastapi import HTTPException
from PIL import Image, ImageOps
from pypdf import PdfReader
import pypdfium2 as pdfium
from .config import settings

TYPES = {"PNG": ("image/png", {".png"}), "JPEG": ("image/jpeg", {".jpg", ".jpeg"}),
         "WEBP": ("image/webp", {".webp"}), "PDF": ("application/pdf", {".pdf"})}
_pdf_lock = threading.Lock()  # PDFium no es seguro entre hilos.


def safe_filename(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1]
    name = "".join(c for c in name if not unicodedata.category(c).startswith("C") and c not in ':<>"|?*')
    name = name.strip().strip('.')
    if not name or len(name) > 255:
        raise HTTPException(422, "El nombre del archivo debe tener entre 1 y 255 caracteres")
    return name


def inspect_file(data: bytes, name: str) -> tuple[str, bytes]:
    """Valida estructura y genera PNG separado, sin ejecutar JS ni extraer texto."""
    config = settings()
    try:
        if data.startswith(b"%PDF-"):
            kind = "PDF"
            if not data.rstrip().endswith(b"%%EOF"):
                raise ValueError("PDF incompleto")
            pdf = PdfReader(BytesIO(data), strict=True)
            if pdf.is_encrypted:
                raise HTTPException(415, "No se admiten PDF protegidos con contraseña")
            if not 1 <= len(pdf.pages) <= config.max_pdf_pages:
                raise HTTPException(413, f"El PDF debe tener entre 1 y {config.max_pdf_pages} páginas")
            with _pdf_lock:
                document = pdfium.PdfDocument(data)
                try:
                    page = document[0]
                    try:
                        width, height = page.get_size()
                        if min(width, height) <= 0:
                            raise ValueError("Página inválida")
                        bitmap = page.render(scale=min(1.5, 1200 / max(width, height)), may_draw_forms=False)
                        try:
                            preview = bitmap.to_pil().copy()
                        finally:
                            bitmap.close()
                    finally:
                        page.close()
                finally:
                    document.close()
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(data)) as image:
                    kind = image.format
                    if kind not in TYPES or kind == "PDF":
                        raise ValueError("Formato no admitido")
                    if image.width * image.height > config.max_image_pixels:
                        raise HTTPException(413, f"La imagen supera el límite de {config.max_image_pixels} píxeles")
                    image.verify()
                with Image.open(BytesIO(data)) as image:
                    image.load()
                    preview = ImageOps.exif_transpose(image).convert("RGB")
                    preview.thumbnail((1200, 1200))
        mime, extensions = TYPES[kind]
        if PurePosixPath(name).suffix.lower() not in extensions:
            preview.close()
            raise HTTPException(415, "La extensión no coincide con el contenido real del archivo")
        output = BytesIO()
        try:
            # No copiar metadatos EXIF, texto ni perfiles al PNG derivado.
            clean = Image.new("RGB", preview.size)
            clean.paste(preview)
            clean.save(output, format="PNG")
            clean.close()
        finally:
            preview.close()
        return mime, output.getvalue()
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(413, "La imagen supera el límite de píxeles permitido")
    except Exception:
        raise HTTPException(415, "Archivo inválido o dañado. Usa PNG, JPEG, WebP o PDF válido")
