// Windows resource embedding: brand the .exe with the Stuard icon and "Stuard AI"
// version metadata (ProductName / FileDescription / CompanyName) so it appears as
// "Stuard AI" with the Stuard logo in Task Manager, the taskbar, and Properties.
//
// Best-effort: if the Windows resource compiler isn't available we warn and build
// the binary without the metadata rather than failing the whole build. No-op on
// macOS / Linux.
fn main() {
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("icon.ico");
        res.set("ProductName", "Stuard AI");
        res.set("FileDescription", "Stuard AI File Indexer");
        res.set("CompanyName", "Stuard AI");
        res.set("LegalCopyright", "\u{00A9} Stuard AI");
        res.set("OriginalFilename", "stuard-file-indexer.exe");
        if let Err(e) = res.compile() {
            println!("cargo:warning=winresource failed to embed icon/metadata: {e}");
        }
        // Rebuild the resource if the icon changes.
        println!("cargo:rerun-if-changed=icon.ico");
        println!("cargo:rerun-if-changed=build.rs");
    }
}
