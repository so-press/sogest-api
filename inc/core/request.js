import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();

export function setRequestContext(req, res, next) {
  requestContext.run({ req }, () => {
    next();
  });
}

export function getRequest() {
  const store = requestContext.getStore();
  return store?.req;
}
