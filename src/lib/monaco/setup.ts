import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// monaco-editor 0.56 exports map: "./*" -> "./esm/vs/*.js"
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

let configured = false;

/** Configure Monaco for Vite workers + local npm bundle (call once before first mount). */
export function setupMonaco(): void {
  if (configured) return;
  configured = true;

  (self as typeof self & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment =
    {
      getWorker(_workerId: string, label: string) {
        if (label === "json") return new jsonWorker();
        if (label === "css" || label === "scss" || label === "less") {
          return new cssWorker();
        }
        if (label === "html" || label === "handlebars" || label === "razor") {
          return new htmlWorker();
        }
        if (label === "typescript" || label === "javascript") {
          return new tsWorker();
        }
        return new editorWorker();
      },
    };

  loader.config({ monaco });

  // Monaco 0.56+: language service defaults live on the top-level `typescript` ns.
  monaco.typescript.javascriptDefaults.setEagerModelSync(true);
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  monaco.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    checkJs: true,
    allowJs: true,
  });
}
