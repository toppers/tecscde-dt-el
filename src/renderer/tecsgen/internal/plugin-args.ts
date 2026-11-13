// tecsgen 1.9.1 の Plugin#parse_plugin_arg（tecslib/core/plugin.rb）の移植。
// `名前=値, 名前=値` を左から読む。値は `\"..\"`・`%..%`・`!..!`・`'..'` で囲めば `,` を含められる。

export function parsePluginArgs(text: string): [string, string][] {
  const result: [string, string][] = [];
  let arg = text.replace(/\\\n/g, "");
  const skip = (): void => {
    arg = arg.replace(/^\s*(?:\\\n)*\s*/, "");
  };
  while (arg !== "") {
    skip();
    if (arg === "") break;
    const ident = /^[a-zA-Z_]\w*/.exec(arg)?.[0];
    if (!ident) throw new Error(`P1001 plugin arg: cannot find identifier in ${arg}`);
    arg = arg.slice(ident.length);
    skip();
    const eq = arg.indexOf("=");
    if (eq < 0) throw new Error(`P1002 plugin arg: expecting '=' not '${arg}'`);
    arg = arg.slice(eq + 1);
    skip();
    let rhs: string | undefined;
    let remain = "";
    const quoted: RegExp[] = [/^\\"(.*?)\\"\s*,/s, /^%(.*?)%\s*,/s, /^!(.*?)!\s*,/s, /^'(.*?)'\s*,/s,
      /^\\"(.*?)\\"\s*$/s, /^%(.*?)%\s*$/s, /^!(.*?)!\s*$/s, /^'(.*?)'\s*$/s];
    for (const pattern of quoted) {
      const m = pattern.exec(arg);
      if (m) {
        rhs = m[1] ?? "";
        remain = arg.slice(m[0].length);
        break;
      }
    }
    if (rhs === undefined) {
      const comma = /^(.*?),/s.exec(arg);
      if (comma) {
        rhs = (comma[1] ?? "").replace(/^\s*/, "");
        remain = arg.slice(comma[0].length);
      } else {
        rhs = (/^(.*?)\s*$/s.exec(arg)?.[1]) ?? "";
        remain = "";
      }
    }
    if (rhs === "") rhs = " ";
    arg = remain;
    skip();
    rhs = rhs.replace(/\\(.)/g, "$1");
    result.push([ident, rhs]);
  }
  return result;
}
