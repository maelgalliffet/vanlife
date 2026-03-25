export async function parseApiErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    return payload.message ?? fallbackMessage;
}

export async function expectOk(
    response: Response,
    fallbackMessage: string,
    toError: (message: string) => Error = (message) => new Error(message)
): Promise<void> {
    if (!response.ok) {
        throw toError(await parseApiErrorMessage(response, fallbackMessage));
    }
}