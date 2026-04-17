export function badRequest(message = 'Bad Request') {
  return { statusCode: 400, message };
}

export function unauthorized(message = 'Unauthorized') {
  return { statusCode: 401, message };
}

export function forbidden(message = 'Forbidden') {
  return { statusCode: 403, message };
}

export function notFound(message = 'Not Found') {
  return { statusCode: 404, message };
}

export function conflict(message = 'Conflict') {
  return { statusCode: 409, message };
}

export function unprocessableEntity(message = 'Unprocessable Entity') {
  return { statusCode: 422, message };
}

export function internal(message = 'Internal Server Error') {
  return { statusCode: 500, message };
}
