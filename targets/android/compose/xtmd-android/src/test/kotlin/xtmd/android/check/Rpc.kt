package xtmd.android.check

import java.io.InputStream
import java.io.OutputStream
import java.io.PrintStream
import org.json.JSONArray
import org.json.JSONObject

// JSON-RPC 2.0, one message per line on standard input and output, for both check adapters
// (Extended Mark's target checks, and omnicui's widget contracts). Standard output carries replies only.

/** omnicui's error codes (omnicui/docs/SPEC.md §4.4), and JSON-RPC's own. */
const val NO_COMPONENT = -32001
const val NO_PART = -32002
const val STEP_FAILED = -32003
const val FAILED = -32000
const val NO_METHOD = -32601

class RpcError(val code: Int, message: String) : Exception(message)

class Request(val id: Any?, val method: String, val params: JSONObject)

fun log(message: String) = System.err.println("[android] $message")

class Rpc(input: InputStream, output: OutputStream) {
    private val reader = input.bufferedReader(Charsets.UTF_8)
    private val out = PrintStream(output, true, "UTF-8")

    /** The next request, or null when standard input is closed. */
    fun next(): Request? {
        while (true) {
            val line = reader.readLine() ?: return null
            if (line.isBlank()) continue
            try {
                val o = JSONObject(line)
                return Request(o.opt("id"), o.optString("method"), o.optJSONObject("params") ?: JSONObject())
            } catch (e: Exception) {
                send(JSONObject().put("id", JSONObject.NULL).put("error", JSONObject().put("code", -32700).put("message", "parse error")))
            }
        }
    }

    fun reply(id: Any?, result: Any?) = send(JSONObject().put("id", id ?: JSONObject.NULL).put("result", json(result)))

    /** A reply whose result is JSON text already (an observation, as the runtime wrote it). */
    fun replyRaw(id: Any?, resultJson: String) {
        val idText = when (id) {
            null -> "null"
            is String -> JSONObject.quote(id)
            else -> id.toString()
        }
        out.println("{\"jsonrpc\":\"2.0\",\"id\":$idText,\"result\":$resultJson}")
    }

    fun error(id: Any?, code: Int, message: String) =
        send(JSONObject().put("id", id ?: JSONObject.NULL).put("error", JSONObject().put("code", code).put("message", message.lineSequence().first())))

    private fun send(o: JSONObject) {
        o.put("jsonrpc", "2.0")
        out.println(o.toString())
    }

    private fun json(v: Any?): Any = when (v) {
        null -> JSONObject.NULL
        is Map<*, *> -> JSONObject().also { o -> v.forEach { (k, x) -> o.put(k.toString(), json(x)) } }
        is List<*> -> JSONArray().also { a -> v.forEach { a.put(json(it)) } }
        is Float -> v.toDouble()
        else -> v
    }
}
