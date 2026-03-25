process.env.LOCAL_DEV = process.env.LOCAL_DEV ?? "true";
export { };

const { default: app } = await import("./index.js");

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
    console.log(`[api-lambda] Local API running on http://localhost:${port}`);
});
