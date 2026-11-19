package xtmd.sample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.Alignment
import xtmd.android.XtmdPage
import xtmd.android.rememberAssetPage
import xtmd.android.XtmdTheme
import xtmd.android.str

/** Two pages drawn by xtmd-android, from IR built with the app: the shop example, and a tour. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { SampleApp() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SampleApp() {
    // each page runs on Extended Mark's native runtime, read and mounted off the main thread (an IR holds all
    // of core: a fraction of a second on a budget phone, which would hold the first frame up)
    val pages = listOf("Shop" to rememberAssetPage("shop.ir.json"), "Tour" to rememberAssetPage("tour.ir.json"))
    var at by rememberSaveable { mutableIntStateOf(0) }
    val snack = remember { SnackbarHostState() }
    MaterialTheme(colorScheme = XtmdTheme.colors(isSystemInDarkTheme())) {
        Scaffold(
            topBar = { TopAppBar(title = { Text("Extended Mark on Android") }) },
            snackbarHost = { SnackbarHost(snack) },
        ) { pad ->
            Column(Modifier.padding(pad).fillMaxSize()) {
                PrimaryTabRow(selectedTabIndex = at) {
                    pages.forEachIndexed { k, (name, _) -> Tab(selected = k == at, onClick = { at = k }, text = { Text(name) }) }
                }
                val page = pages[at].second
                if (page == null) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                } else {
                    // what the page tells the app: the shop's `shop.checkout(total, count)`
                    LaunchedEffect(page, page.revision) {
                        for (call in page.takeCalls()) {
                            val args = call.args.map { it.str() }
                            snack.showSnackbar(if (call.name.endsWith(".checkout")) "Checked out ${args.getOrNull(1)} items for ${args.getOrNull(0)} €" else "${call.name}(${args.joinToString()})")
                        }
                    }
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                        XtmdPage(page)
                    }
                }
            }
        }
    }
}
