export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string = "domain_error",
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, "not_found");
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super(message, "forbidden");
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, "validation");
  }
}

export class LimitExceededError extends DomainError {
  constructor(
    readonly metric: string,
    readonly limit: number,
  ) {
    super(`Plan limit reached for ${metric} (${limit})`, "limit_exceeded");
  }
}
