"""Domain errors raised by services and translated to HTTP by app.main.

Services never import FastAPI. They raise these, and one exception handler turns
them into the JSON error body documented in docs/api.md:

    {"detail": "human readable message", "code": "machine_readable_code"}
"""


class AppError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


class NotFoundError(AppError):
    """Referenced user/device does not exist."""

    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    """Same ID, different content (e.g. focus session UUID reused)."""

    status_code = 409
    code = "conflict"


class InvalidDataError(AppError):
    """Well-formed JSON that breaks a business rule (range, ordering, future time)."""

    status_code = 422
    code = "invalid_data"
