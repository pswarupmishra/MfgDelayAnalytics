async function post(url, body) {
  const headers = body instanceof FormData ? undefined : { "Content-Type": "application/json" };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.detail || "Request failed");
    error.response = { data };
    throw error;
  }
  return { data };
}

export default { post };
